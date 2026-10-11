import {
  contextUpTo, evaluateEntry, formatScanTable, grossPnl, INTERVAL_MS, insertTrade, loadPosition, logEvent, manage, recordEquity, requiredCandles, requiredContext,
  rollAccountDay, roe as roeOf, saveBotState, savePosition, saveScan, scanCoin, takeCommand, type AccountState, type AppConfig, type AssetSpec, type Candle,
  type DB, type EntrySignal, type HyperliquidInfo, type Position, type RiskGuard, type ScanRow, type StrategyContext, type Trade,
} from "@talon/core";
import type { Executor } from "./executor.js";
import { LiveExecutor } from "./live.js";
import { PaperExecutor } from "./paper.js";

export type Status = "running" | "paused" | "halted";

export class Engine {
  acct: AccountState;
  status: Status = "running";
  readonly runId = `${Date.now().toString(36)}`;
  readonly startedAt = Date.now();
  private lastCandleT = 0;
  private lastFundingHour = 0;
  private lastTs: number | null = null;
  private mids: Record<string, number> = {};
  private candles: Record<string, { primary: Candle[]; context: Candle[] }> = {};
  private stopping = false;
  /** a halt whose flatten failed; retried every tick */
  private flattenPending: string | null = null;
  private quoteWarned = false;

  constructor(
    private readonly cfg: AppConfig, private readonly db: DB, private readonly guard: RiskGuard, private readonly specs: Map<string, AssetSpec>,
    private readonly info: HyperliquidInfo, private readonly exec: Executor, private readonly log: (s: string) => void, initialEquity: number,
    restored: { halted: boolean; haltReason: string | null; peak?: number; dayStart?: number; status?: Status; lastTick?: number },
  ) {
    this.acct = { equity: initialEquity, dayStartEquity: restored.dayStart ?? initialEquity, peakEquity: restored.peak ?? initialEquity, dayPnl: 0, position: null, halted: restored.halted, haltReason: restored.haltReason };
    // seed the day-roll clock from the last persisted tick so a restart does not reset the daily-loss baseline
    this.lastTs = restored.lastTick ?? null;
    if (restored.halted) this.status = "halted"; else if (restored.status) this.status = restored.status;
  }

  get mode() { return this.cfg.mode; }
  mark(coin: string): number { return this.mids[coin] ?? 0; }

  async start(): Promise<void> {
    await this.refreshMids();
    await this.restorePosition();
    await this.refreshCandles();
    const rows = this.scanAll();
    saveScan(this.db, this.mode, rows);
    this.log("startup market scan:\n" + formatScanTable(rows));
    this.lastCandleT = this.currentBoundary();
    this.lastFundingHour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    logEvent(this.db, this.mode, "info", `bot started (${this.mode}, ${this.cfg.strategy.name}, ${this.cfg.universe.join("/")}, ${this.cfg.risk.leverage}x, ${(this.cfg.risk.sizeFraction * 100).toFixed(0)}% size) status=${this.status}`);
    this.persist();
    const stop = () => { this.stopping = true; };
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
    while (!this.stopping) {
      const t0 = Date.now();
      try { await this.tick(); } catch (e) { this.log(`tick error: ${(e as Error).message}`); logEvent(this.db, this.mode, "error", `tick error: ${(e as Error).message}`); }
      const wait = Math.max(1000, this.cfg.pollIntervalMs - (Date.now() - t0));
      await new Promise((r) => setTimeout(r, wait));
    }
    this.log("stopping (position and stop orders stay as they are)");
    this.persist("stopped");
  }

  // ---------------- tick ----------------
  async tick(): Promise<void> {
    const now = Date.now();
    await this.handleCommand();
    await this.refreshMids();
    if (this.flattenPending) await this.halt(this.flattenPending, true);
    if (this.exec.kind === "live") await this.reconcileLive();
    const pos = this.acct.position;
    if (pos && !(this.mark(pos.coin) > 0)) {
      if (!this.quoteWarned) { this.log(`no quote for ${pos.coin}; skipping stop/equity checks this tick`); this.quoteWarned = true; }
    } else {
      this.quoteWarned = false;
      await this.applyPaperFunding(now);
      await this.checkPaperStops();
    }

    // equity, day roll, halts
    const equity = await this.exec.equity();
    this.acct = rollAccountDay(this.acct, equity, now, this.lastTs);
    this.lastTs = now;
    if (!this.acct.halted) {
      const halt = this.guard.checkHalt(this.acct);
      if (halt) await this.halt(`kill switch: ${halt}`);
    }

    // new closed candle?
    const boundary = this.currentBoundary();
    if (boundary > this.lastCandleT && now >= boundary + 4000) {
      await this.refreshCandles();
      this.lastCandleT = boundary;
      const rows = this.scanAll();
      saveScan(this.db, this.mode, rows);
      await this.onCandle();
    }
    this.persist();
  }

  private currentBoundary(): number {
    const ims = INTERVAL_MS[this.cfg.interval];
    return Math.floor(Date.now() / ims) * ims;
  }

  private async handleCommand(): Promise<void> {
    const cmd = takeCommand(this.db, this.mode);
    if (!cmd) return;
    this.log(`command: ${cmd}`);
    logEvent(this.db, this.mode, "info", `command received: ${cmd}`);
    if (cmd === "start" && !this.acct.halted) this.status = "running";
    else if (cmd === "pause" && !this.acct.halted) this.status = "paused";
    else if (cmd === "kill") await this.halt("manual kill switch");
    else if (cmd === "start" || cmd === "pause") logEvent(this.db, this.mode, "warn", `'${cmd}' ignored: bot is halted (${this.acct.haltReason}); send reset first`);
    else if (cmd === "reset") {
      this.acct.halted = false; this.acct.haltReason = null;
      this.acct.peakEquity = this.acct.equity; this.acct.dayStartEquity = this.acct.equity; this.acct.dayPnl = 0;
      this.status = "paused";
      logEvent(this.db, this.mode, "warn", "halt reset manually; baselines reset; status=paused (press start)");
    }
  }

  /** Flatten everything and halt until manual reset. A failed flatten is retried on every tick until it succeeds. */
  private async halt(reason: string, retry = false): Promise<void> {
    if (!retry) {
      this.log(`HALT: ${reason}`);
      logEvent(this.db, this.mode, "error", `HALT: ${reason} — flattening`);
    }
    this.acct.halted = true; this.acct.haltReason = reason; this.status = "halted";
    try {
      if (this.acct.position) await this.closePosition(this.mark(this.acct.position.coin), reason);
      await this.exec.flattenAll(reason);
      if (this.flattenPending) logEvent(this.db, this.mode, "warn", "flatten succeeded on retry");
      this.flattenPending = null;
    } catch (e) {
      this.flattenPending = reason;
      this.log(`!! flatten failed (${(e as Error).message}); will retry next tick`);
      if (!retry) logEvent(this.db, this.mode, "error", `flatten failed: ${(e as Error).message} — retrying every tick`);
    }
    this.persist();
  }

  // ---------------- data ----------------
  private async refreshMids(): Promise<void> {
    const mids = await this.info.allMids();
    for (const c of this.cfg.universe) if (mids[c]) this.mids[c] = mids[c];
  }

  private async refreshCandles(): Promise<void> {
    const ims = INTERVAL_MS[this.cfg.interval], cms = INTERVAL_MS[this.cfg.contextInterval];
    const nP = requiredCandles(this.cfg.strategy) + 20, nC = requiredContext(this.cfg.strategy) + 10;
    const now = Date.now();
    for (const coin of this.cfg.universe) {
      const [p, c] = await Promise.all([
        this.info.candles(coin, this.cfg.interval, now - nP * ims, now),
        this.info.candles(coin, this.cfg.contextInterval, now - nC * cms, now),
      ]);
      this.candles[coin] = { primary: p.filter((k) => k.t + ims <= now), context: c.filter((k) => k.t + cms <= now) };
    }
  }

  private ctx(coin: string): StrategyContext {
    const d = this.candles[coin];
    const closeTime = d.primary[d.primary.length - 1].t + INTERVAL_MS[this.cfg.interval];
    return { coin, candles: d.primary, context: contextUpTo(d.context, INTERVAL_MS[this.cfg.contextInterval], closeTime), params: this.cfg.strategy };
  }

  scanAll(): ScanRow[] {
    const t = Date.now();
    return this.cfg.universe.filter((c) => this.candles[c]?.primary.length > 50).map((c) => scanCoin(c, this.candles[c].primary, this.candles[c].context, this.cfg.strategy, t));
  }

  // ---------------- candle logic ----------------
  private async onCandle(): Promise<void> {
    const pos = this.acct.position;
    if (pos && this.candles[pos.coin]) {
      pos.barsHeld += 1;
      const k = this.candles[pos.coin].primary.at(-1)!;
      pos.bestPrice = pos.side === "long" ? Math.max(pos.bestPrice, k.h) : Math.min(pos.bestPrice, k.l);
      const act = manage(this.ctx(pos.coin), pos);
      if (act?.exit) await this.closePosition(this.mark(pos.coin), act.exit.reason);
      else if (act?.newStop !== undefined) {
        const ns = this.guard.finalStop(pos.coin, pos.side, pos.entryPrice, act.newStop, pos.leverage);
        const tighter = pos.side === "long" ? ns > pos.stopPrice : ns < pos.stopPrice;
        if (tighter) {
          const oid = await this.exec.updateStop(pos, ns);
          pos.stopPrice = ns; if (oid) pos.stopOrderId = oid;
          this.log(`${pos.coin} trailing stop → ${ns}`);
          logEvent(this.db, this.mode, "info", `${pos.coin} trailing stop moved to ${ns}`);
        }
      }
    }
    if (this.status !== "running" || this.acct.position || this.acct.halted) return;
    let best: EntrySignal | null = null;
    for (const coin of this.cfg.universe) {
      if (!this.candles[coin]) continue;
      const s = evaluateEntry(this.ctx(coin));
      if (s && (!best || s.volumeRatio > best.volumeRatio)) best = s;
    }
    if (!best) return;
    const mark = this.mark(best.coin);
    const d = this.guard.approve({ coin: best.coin, side: best.side, refPrice: mark || best.refPrice, stopPrice: best.stopPrice, tpPrice: best.tpPrice, leverage: this.cfg.risk.leverage, reason: best.reason }, this.acct);
    if (!d.ok) { this.log(`signal ${best.coin} ${best.side} rejected by RiskGuard: ${d.reason}`); logEvent(this.db, this.mode, "warn", `signal ${best.coin} ${best.side} rejected: ${d.reason}`); return; }
    const o = d.order;
    const stopDist = Math.abs(best.refPrice - best.stopPrice);
    const protect = (fillPx: number) => ({
      stop: this.guard.finalStop(o.coin, o.side, fillPx, o.side === "long" ? fillPx - stopDist : fillPx + stopDist, o.leverage),
      tp: o.tpPrice === null ? null : (o.side === "long" ? fillPx + this.cfg.strategy.rMultiple * stopDist : fillPx - this.cfg.strategy.rMultiple * stopDist),
    });
    this.log(`ENTRY ${o.coin} ${o.side} qty ${o.qty} @~${mark} lev ${o.leverage}x margin ${o.margin.toFixed(2)} | ${o.reason}`);
    try {
      const r = await this.exec.open(o, mark, protect);
      const pos: Position = {
        coin: o.coin, side: o.side, qty: r.fill.qty, entryPrice: r.fill.price, entryTime: r.fill.time, leverage: o.leverage, margin: (r.fill.qty * r.fill.price) / o.leverage,
        stopPrice: r.stop, tpPrice: r.tp, initialStop: r.stop, atr: best.atr, bestPrice: r.fill.price, barsHeld: 0, reasonEntry: o.reason, funding: 0, fees: r.fill.fee, stopOrderId: r.stopOrderId,
        units: 1, lastFillPrice: r.fill.price, equityBefore: this.acct.equity,
      };
      this.acct.position = pos;
      if (this.exec instanceof PaperExecutor) this.exec.setPosition(pos);
      this.lastFundingHour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
      logEvent(this.db, this.mode, "trade", `OPEN ${pos.coin} ${pos.side} ${pos.qty} @ ${pos.entryPrice} stop ${pos.stopPrice} tp ${pos.tpPrice ?? "-"} lev ${pos.leverage}x | ${pos.reasonEntry}`);
      savePosition(this.db, this.mode, pos);
    } catch (e) {
      this.log(`entry failed: ${(e as Error).message}`);
      logEvent(this.db, this.mode, "error", `entry failed: ${(e as Error).message}`);
    }
  }

  // ---------------- position lifecycle ----------------
  private async closePosition(price: number, reason: string, fillOverride?: { price: number; qty: number; fee: number; time: number }): Promise<void> {
    const pos = this.acct.position;
    if (!pos) return;
    const fill = fillOverride ?? (await this.exec.close(pos, price, reason));
    if (this.exec instanceof LiveExecutor) {
      try { pos.funding = await this.exec.fundingSince(pos.coin, pos.entryTime); } catch (e) { this.log(`warn: funding lookup failed: ${(e as Error).message}`); }
    }
    this.acct.position = null;
    if (this.exec instanceof PaperExecutor) this.exec.setPosition(null);
    // trade row, position row and bot state change together
    this.db.transaction(() => {
      this.recordTrade(pos, fill, reason);
      savePosition(this.db, this.mode, null);
      this.persist();
    })();
  }

  private recordTrade(pos: Position, fill: { price: number; qty: number; fee: number; time: number }, reason: string): void {
    const gross = grossPnl(pos.side, pos.entryPrice, fill.price, fill.qty);
    const fees = pos.fees + fill.fee;
    const net = gross - fees + pos.funding;
    this.acct.dayPnl += net;
    const tr: Trade = {
      mode: this.mode, runId: this.runId, coin: pos.coin, side: pos.side, leverage: pos.leverage, qty: fill.qty, entryPrice: pos.entryPrice, entryTime: pos.entryTime,
      exitPrice: fill.price, exitTime: fill.time, stopPrice: pos.initialStop, tpPrice: pos.tpPrice, grossPnl: gross, fees, funding: pos.funding, pnl: net, roe: roeOf(net, pos.margin),
      reasonEntry: pos.reasonEntry, reasonExit: reason,
    };
    insertTrade(this.db, tr);
    this.log(`EXIT ${pos.coin} ${pos.side} @ ${fill.price} pnl ${net.toFixed(2)} (roe ${(tr.roe * 100).toFixed(1)}%) fees ${fees.toFixed(2)} funding ${pos.funding.toFixed(2)} | ${reason}`);
    logEvent(this.db, this.mode, "trade", `CLOSE ${pos.coin} ${pos.side} @ ${fill.price} pnl ${net.toFixed(2)} roe ${(tr.roe * 100).toFixed(1)}% | ${reason}`);
  }

  private async checkPaperStops(): Promise<void> {
    const pos = this.acct.position;
    if (!pos || this.exec.kind !== "paper") return;
    const m = this.mark(pos.coin);
    if (!m) return;
    const stopHit = pos.side === "long" ? m <= pos.stopPrice : m >= pos.stopPrice;
    const tpHit = pos.tpPrice !== null && (pos.side === "long" ? m >= pos.tpPrice : m <= pos.tpPrice);
    // a stop-market fills at the trigger or worse if the quote already gapped through it
    const stopFill = pos.side === "long" ? Math.min(pos.stopPrice, m) : Math.max(pos.stopPrice, m);
    if (stopHit) await this.closePosition(stopFill, pos.stopPrice === pos.initialStop ? "stop" : "trailing stop");
    else if (tpHit) await this.closePosition(pos.tpPrice!, "take profit");
  }

  private async applyPaperFunding(now: number): Promise<void> {
    const pos = this.acct.position;
    if (!pos || !(this.exec instanceof PaperExecutor)) return;
    const hour = Math.floor(now / 3_600_000) * 3_600_000;
    if (hour <= this.lastFundingHour) return;
    const ctxs = await this.info.assetCtxs([pos.coin]);
    const rate = ctxs.get(pos.coin)?.funding ?? this.cfg.fees.defaultHourlyFunding;
    const pay = this.exec.applyFunding(pos, rate, this.mark(pos.coin));
    this.lastFundingHour = hour;
    this.log(`funding ${pos.coin}: rate ${rate} → ${pay.toFixed(4)}`);
    savePosition(this.db, this.mode, pos);
  }

  /** Live: trust the exchange. Detect stop/tp fills, adopt unknown positions, never leave one unprotected. */
  private async reconcileLive(): Promise<void> {
    const live = this.exec as LiveExecutor;
    const positions = await live.exchangePositions();
    const pos = this.acct.position;
    if (pos) {
      const ex = positions.find((p) => p.coin === pos.coin);
      if (!ex) {
        const fills = await live.closingFills(pos.coin, pos.entryTime);
        const qty = fills.reduce((s, f) => s + f.qty, 0);
        const price = qty > 0 ? fills.reduce((s, f) => s + f.price * f.qty, 0) / qty : this.mark(pos.coin);
        const fee = fills.reduce((s, f) => s + f.fee, 0);
        const nearStop = Math.abs(price - pos.stopPrice) <= Math.abs(price - (pos.tpPrice ?? Infinity));
        await live.cancelAll(pos.coin);
        await this.closePosition(price, nearStop ? "stop (exchange)" : "take profit (exchange)", { price, qty: qty || pos.qty, fee, time: fills.at(-1)?.time ?? Date.now() });
        return;
      }
      if (Math.abs(ex.qty - pos.qty) > 1e-9) { this.log(`position size changed on exchange: ${pos.qty} → ${ex.qty}`); pos.qty = ex.qty; }
      if (!(await live.findStopOrder(pos.coin))) {
        this.log(`!! stop order missing for ${pos.coin}; re-placing at ${pos.stopPrice}`);
        logEvent(this.db, this.mode, "warn", `${pos.coin}: stop order missing on exchange, re-placed at ${pos.stopPrice}`);
        pos.stopOrderId = await live.ensureStop(pos.coin, pos.side, pos.qty, pos.entryPrice, pos.leverage, pos.stopPrice);
      }
    }
    for (const ex of positions) {
      if (pos && ex.coin === pos.coin) continue;
      this.log(`!! adopting unknown exchange position ${ex.coin} ${ex.side} ${ex.qty}`);
      logEvent(this.db, this.mode, "warn", `adopted exchange position ${ex.coin} ${ex.side} ${ex.qty} @ ${ex.entryPx} (${ex.leverage}x)${ex.leverage > this.guard.cfg.maxLeverage ? " — leverage above the configured cap; reduce it manually" : ""}`);
      const stopOrderId = await live.ensureStop(ex.coin, ex.side, ex.qty, ex.entryPx, ex.leverage);
      if (!this.acct.position) {
        const stop = this.guard.finalStop(ex.coin, ex.side, ex.entryPx, ex.side === "long" ? 0 : Infinity, ex.leverage);
        this.acct.position = { coin: ex.coin, side: ex.side, qty: ex.qty, entryPrice: ex.entryPx, entryTime: Date.now(), leverage: ex.leverage, margin: ex.margin, stopPrice: stop, tpPrice: null, initialStop: stop, atr: 0, bestPrice: ex.entryPx, barsHeld: 0, reasonEntry: "adopted from exchange", funding: 0, fees: 0, stopOrderId, units: 1, lastFillPrice: ex.entryPx, equityBefore: this.acct.equity };
        savePosition(this.db, this.mode, this.acct.position);
      }
    }
  }

  private async restorePosition(): Promise<void> {
    const saved = loadPosition(this.db, this.mode);
    if (this.exec.kind === "paper") {
      if (saved) { this.acct.position = saved; (this.exec as PaperExecutor).setPosition(saved); this.log(`restored paper position ${saved.coin} ${saved.side} ${saved.qty} @ ${saved.entryPrice}`); }
      return;
    }
    if (saved) this.acct.position = saved;
    await this.reconcileLive();
  }

  // ---------------- persistence ----------------
  private persist(statusOverride?: string): void {
    const pos = this.acct.position;
    const unreal = pos ? grossPnl(pos.side, pos.entryPrice, this.mark(pos.coin), pos.qty) - pos.fees + pos.funding : 0;
    const now = Date.now();
    recordEquity(this.db, this.mode, Math.floor(now / 60_000) * 60_000, this.acct.equity, unreal, this.runId);
    saveBotState(this.db, {
      mode: this.mode, status: statusOverride ?? this.status, lastTick: now, equity: this.acct.equity, dayStartEquity: this.acct.dayStartEquity, peakEquity: this.acct.peakEquity,
      halted: this.acct.halted, haltReason: this.acct.haltReason, startedAt: this.startedAt, runId: this.runId,
      info: {
        strategy: this.cfg.strategy.name, interval: this.cfg.interval, universe: this.cfg.universe, leverage: this.cfg.risk.leverage, sizeFraction: this.cfg.risk.sizeFraction,
        dailyLossLimitPct: this.cfg.risk.dailyLossLimitPct, maxDrawdownPct: this.cfg.risk.maxDrawdownPct, hardStopRoe: this.cfg.risk.hardStopRoe, mids: this.mids,
        cash: this.exec instanceof PaperExecutor ? this.exec.cash : null, lastCandle: this.lastCandleT, testnet: this.cfg.live.testnet,
        baseEquity: this.guard.cfg.baseEquity, lastStatus: this.status, flattenPending: this.flattenPending,
      },
    });
    if (pos) savePosition(this.db, this.mode, pos);
  }
}
