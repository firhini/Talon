import type { FeeConfig } from "./config.js";
import { feeCost, fundingPayment, grossPnl, isBuy, roe as roeOf, slippedPrice } from "./fees.js";
import { RiskGuard, rollAccountDay } from "./risk.js";
import { contextUpTo, evaluateEntry, INTERVAL_MS, manage, requiredCandles, requiredContext, type StrategyContext } from "./strategy.js";
import type { AccountState, ApprovedOrder, AssetSpec, Candle, EntrySignal, Interval, Position, RiskConfig, StrategyParams, Trade } from "./types.js";

export interface BacktestInput {
  coins: string[];
  candles: Record<string, Candle[]>;
  context: Record<string, Candle[]>;
  funding: Record<string, { t: number; rate: number }[]>;
  interval: Interval;
  contextInterval: Interval;
  params: StrategyParams;
  risk: RiskConfig;
  fees: FeeConfig;
  specs: Map<string, AssetSpec>;
  startEquity: number;
  from?: number;
  to?: number;
  /** "halt": drawdown kill switch ends the run (as live would); "off": keep trading (for research) */
  killSwitch?: "halt" | "off";
}

export interface Metrics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  /** average net pnl per trade (USD) */
  expectancy: number;
  /** average pnl per trade in R (initial risk units) */
  expectancyR: number;
  profitFactor: number;
  maxDrawdownPct: number;
  totalReturnPct: number;
  finalEquity: number;
  totalFees: number;
  totalFunding: number;
  longs: number;
  shorts: number;
  avgHoldHours: number;
  sharpe: number;
  /** annualised return / max drawdown */
  calmar: number;
  exitReasons: Record<string, number>;
}

export interface BacktestResult {
  label: string;
  params: StrategyParams;
  risk: RiskConfig;
  fees: FeeConfig;
  from: number;
  to: number;
  startEquity: number;
  metrics: Metrics;
  metricsNoFees: Metrics;
  trades: Trade[];
  equityCurve: { t: number; equity: number }[];
  equityCurveNoFees: { t: number; equity: number }[];
  haltedAt: number | null;
  haltReason: string | null;
  dailyHalts: number;
}

interface Pending { order: ApprovedOrder; signal: EntrySignal }

export function runBacktest(input: BacktestInput, label = "backtest"): BacktestResult {
  const { coins, params, fees, risk, specs } = input;
  const ims = INTERVAL_MS[input.interval];
  const cms = INTERVAL_MS[input.contextInterval];
  const W = requiredCandles(params);
  const WC = requiredContext(params);
  const guard = new RiskGuard({ ...risk, baseEquity: input.startEquity }, specs);
  const fundingMaps: Record<string, Map<number, number>> = {};
  for (const c of coins) fundingMaps[c] = new Map((input.funding[c] ?? []).map((r) => [Math.floor(r.t / 3_600_000) * 3_600_000, r.rate]));

  // time axis
  const from = input.from ?? 0, to = input.to ?? Number.MAX_SAFE_INTEGER;
  const tset = new Set<number>();
  const series: Record<string, Candle[]> = {};
  const idx: Record<string, Map<number, number>> = {};
  for (const c of coins) {
    series[c] = (input.candles[c] ?? []);
    idx[c] = new Map(series[c].map((k, i) => [k.t, i]));
    for (const k of series[c]) if (k.t >= from && k.t <= to) tset.add(k.t);
  }
  const times = [...tset].sort((a, b) => a - b);

  let cash = input.startEquity;
  let acct: AccountState = { equity: cash, dayStartEquity: cash, peakEquity: cash, dayPnl: 0, position: null, halted: false, haltReason: null };
  let lastTs: number | null = null;
  let pending: Pending | null = null;
  let lastFundingHour = 0;
  let haltedUntilDay: number | null = null;
  let haltedAt: number | null = null, haltReason: string | null = null, dailyHalts = 0;
  const trades: Trade[] = [];
  const equityCurve: { t: number; equity: number }[] = [];
  const runId = `bt-${label}`;
  const dayOf = (t: number) => Math.floor(t / 86_400_000);

  const closeTrade = (pos: Position, exitPx: number, exitTime: number, reason: string, maker = false) => {
    const notional = pos.qty * exitPx;
    const fee = feeCost(notional, maker ? fees.makerFeeBps : fees.takerFeeBps);
    const gross = grossPnl(pos.side, pos.entryPrice, exitPx, pos.qty);
    const totalFees = pos.fees + fee;
    const net = gross - totalFees + pos.funding;
    cash += net;
    acct.dayPnl += net;
    trades.push({
      mode: "backtest", runId, coin: pos.coin, side: pos.side, leverage: pos.leverage, qty: pos.qty, entryPrice: pos.entryPrice, entryTime: pos.entryTime,
      exitPrice: exitPx, exitTime, stopPrice: pos.initialStop, tpPrice: pos.tpPrice, grossPnl: gross, fees: totalFees, funding: pos.funding, pnl: net,
      roe: roeOf(net, pos.margin), reasonEntry: pos.reasonEntry, reasonExit: reason,
    });
    acct.position = null;
  };

  for (const T of times) {
    const Tc = T + ims;
    const pos = acct.position;

    // ---- position management on its own coin's candle ----
    if (pos) {
      const i = idx[pos.coin].get(T);
      if (i !== undefined) {
        const k = series[pos.coin][i];
        // funding at each hour boundary inside (lastFundingHour, Tc]
        for (let h = Math.floor(lastFundingHour / 3_600_000) * 3_600_000 + 3_600_000; h <= Tc; h += 3_600_000) {
          const rate = fundingMaps[pos.coin].get(h) ?? fees.defaultHourlyFunding;
          pos.funding += fundingPayment(pos.side, pos.qty * k.c, rate);
          lastFundingHour = h;
        }
        // stop / take-profit inside the candle (stop first = conservative)
        let exitPx: number | null = null, reason = "", maker = false;
        const sellSlip = (px: number) => slippedPrice(px, isBuy(pos.side, "close"), fees.slippageBps);
        if (pos.side === "long") {
          if (k.o <= pos.stopPrice) { exitPx = sellSlip(k.o); reason = "stop (gap)"; }
          else if (k.l <= pos.stopPrice) { exitPx = sellSlip(pos.stopPrice); reason = pos.stopPrice > pos.initialStop ? "trailing stop" : "stop"; }
          else if (pos.tpPrice !== null && k.o >= pos.tpPrice) { exitPx = sellSlip(k.o); reason = "take profit (gap)"; }
          else if (pos.tpPrice !== null && k.h >= pos.tpPrice) { exitPx = sellSlip(pos.tpPrice); reason = "take profit"; }
        } else {
          if (k.o >= pos.stopPrice) { exitPx = sellSlip(k.o); reason = "stop (gap)"; }
          else if (k.h >= pos.stopPrice) { exitPx = sellSlip(pos.stopPrice); reason = pos.stopPrice < pos.initialStop ? "trailing stop" : "stop"; }
          else if (pos.tpPrice !== null && k.o <= pos.tpPrice) { exitPx = sellSlip(k.o); reason = "take profit (gap)"; }
          else if (pos.tpPrice !== null && k.l <= pos.tpPrice) { exitPx = sellSlip(pos.tpPrice); reason = "take profit"; }
        }
        if (exitPx !== null) {
          closeTrade(pos, exitPx, Tc, reason, maker);
        } else {
          pos.barsHeld += 1;
          pos.bestPrice = pos.side === "long" ? Math.max(pos.bestPrice, k.h) : Math.min(pos.bestPrice, k.l);
          const ctx = makeCtx(pos.coin, series[pos.coin], i, input.context[pos.coin] ?? [], W, WC, cms, Tc, params);
          const act = manage(ctx, pos);
          if (act?.exit) closeTrade(pos, sellSlip(k.c), Tc, act.exit.reason);
          else if (act?.newStop !== undefined) pos.stopPrice = guard.finalStop(pos.coin, pos.side, pos.entryPrice, act.newStop, pos.leverage);
        }
      }
    }

    // ---- fill pending entry at this candle's open (signal came from previous close) ----
    if (pending && !acct.position && !acct.halted) {
      const i = idx[pending.order.coin].get(T);
      if (i !== undefined) {
        const k = series[pending.order.coin][i];
        const o = pending.order;
        const fill = slippedPrice(k.o, isBuy(o.side, "open"), fees.slippageBps);
        const fee = feeCost(o.qty * fill, fees.takerFeeBps);
        const sigDist = Math.abs(pending.signal.refPrice - pending.signal.stopPrice);
        const stop = guard.finalStop(o.coin, o.side, fill, o.side === "long" ? fill - sigDist : fill + sigDist, o.leverage);
        const stopDist = Math.abs(fill - stop);
        const tp = o.tpPrice === null ? null : (o.side === "long" ? fill + params.rMultiple * sigDist : fill - params.rMultiple * sigDist);
        const p: Position = {
          coin: o.coin, side: o.side, qty: o.qty, entryPrice: fill, entryTime: T, leverage: o.leverage, margin: (o.qty * fill) / o.leverage,
          stopPrice: stop, tpPrice: tp, initialStop: stop, atr: pending.signal.atr, bestPrice: fill, barsHeld: 0, reasonEntry: o.reason, funding: 0, fees: fee,
        };
        if (stopDist > 0 && (o.side === "long" ? stop < fill : stop > fill)) {
          acct.position = p;
          lastFundingHour = Math.floor(T / 3_600_000) * 3_600_000;
          // the entry candle itself can hit the stop
          const sellSlip = (px: number) => slippedPrice(px, isBuy(p.side, "close"), fees.slippageBps);
          if (p.side === "long" && k.l <= p.stopPrice) closeTrade(p, sellSlip(p.stopPrice), Tc, "stop (entry bar)");
          else if (p.side === "short" && k.h >= p.stopPrice) closeTrade(p, sellSlip(p.stopPrice), Tc, "stop (entry bar)");
          else if (p.tpPrice !== null && (p.side === "long" ? k.h >= p.tpPrice : k.l <= p.tpPrice)) closeTrade(p, sellSlip(p.tpPrice), Tc, "take profit (entry bar)");
        }
      }
      pending = null;
    }

    // ---- mark to market, day roll, halts ----
    let unreal = 0;
    if (acct.position) {
      const i = idx[acct.position.coin].get(T);
      const mark = i !== undefined ? series[acct.position.coin][i].c : lastClose(series[acct.position.coin], T);
      unreal = grossPnl(acct.position.side, acct.position.entryPrice, mark, acct.position.qty) - acct.position.fees + acct.position.funding;
    }
    const prevDay = lastTs === null ? null : dayOf(lastTs);
    acct = rollAccountDay(acct, cash + unreal, Tc, lastTs);
    if (haltedUntilDay !== null && prevDay !== null && dayOf(Tc) > haltedUntilDay) { haltedUntilDay = null; acct.halted = false; acct.haltReason = null; }
    lastTs = Tc;
    equityCurve.push({ t: Tc, equity: acct.equity });

    if (!acct.halted) {
      const halt = guard.checkHalt(acct);
      if (halt) {
        if (acct.position) {
          const i = idx[acct.position.coin].get(T);
          const mark = i !== undefined ? series[acct.position.coin][i].c : lastClose(series[acct.position.coin], T);
          closeTrade(acct.position, slippedPrice(mark, isBuy(acct.position.side, "close"), fees.slippageBps), Tc, `kill switch: ${halt}`);
          acct.equity = cash;
        }
        pending = null;
        acct.halted = true; acct.haltReason = halt;
        if (halt.startsWith("max drawdown") && (input.killSwitch ?? "halt") === "halt") { haltedAt = Tc; haltReason = halt; break; }
        dailyHalts++;
        haltedUntilDay = dayOf(Tc);
        if (halt.startsWith("max drawdown")) acct.peakEquity = acct.equity; // research mode: reset the peak
      }
    }

    // ---- entries ----
    if (!acct.position && !acct.halted && !pending) {
      let best: EntrySignal | null = null;
      for (const c of coins) {
        const i = idx[c].get(T);
        if (i === undefined || i + 1 >= series[c].length) continue;
        const ctx = makeCtx(c, series[c], i, input.context[c] ?? [], W, WC, cms, Tc, params);
        const s = evaluateEntry(ctx);
        if (s && (!best || s.volumeRatio > best.volumeRatio)) best = s;
      }
      if (best) {
        const d = guard.approve({ coin: best.coin, side: best.side, refPrice: best.refPrice, stopPrice: best.stopPrice, tpPrice: best.tpPrice, leverage: risk.leverage, reason: best.reason }, acct);
        if (d.ok) pending = { order: d.order, signal: best };
      }
    }
  }

  // close any open position at the end of the window
  if (acct.position) {
    const s = series[acct.position.coin];
    const lastT = times[times.length - 1];
    const k = s[Math.min(s.length - 1, idx[acct.position.coin].get(lastT) ?? s.length - 1)];
    closeTrade(acct.position, slippedPrice(k.c, isBuy(acct.position.side, "close"), fees.slippageBps), k.t + ims, "end of backtest");
    equityCurve.push({ t: k.t + ims, equity: cash });
  }

  const metrics = computeMetrics(trades, equityCurve, input.startEquity, ims);
  // without costs: a real second pass with zero fees, slippage and funding (not the same trades: no cost-driven halts)
  const costless = fees.takerFeeBps === 0 && fees.makerFeeBps === 0 && fees.slippageBps === 0 && fees.defaultHourlyFunding === 0 && Object.keys(input.funding).length === 0;
  const noFees = costless ? null : runBacktest({ ...input, fees: { takerFeeBps: 0, makerFeeBps: 0, slippageBps: 0, defaultHourlyFunding: 0 }, funding: {} }, label);
  const metricsNoFees = noFees ? noFees.metrics : metrics;
  const curveNoFees = noFees ? noFees.equityCurve : equityCurve;

  return {
    label, params, risk, fees, from: times[0] ?? 0, to: times[times.length - 1] ?? 0, startEquity: input.startEquity,
    metrics, metricsNoFees, trades, equityCurve: thin(equityCurve, 3000), equityCurveNoFees: curveNoFees, haltedAt, haltReason, dailyHalts,
  };
}

function makeCtx(coin: string, s: Candle[], i: number, context: Candle[], W: number, WC: number, cms: number, Tc: number, params: StrategyParams): StrategyContext {
  const candles = s.slice(Math.max(0, i - W + 1), i + 1);
  const ctxAll = contextUpTo(context, cms, Tc);
  return { coin, candles, context: ctxAll.slice(Math.max(0, ctxAll.length - WC)), params };
}
function lastClose(s: Candle[], T: number): number {
  let lo = 0, hi = s.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (s[m].t <= T) lo = m + 1; else hi = m; }
  return s[Math.max(0, lo - 1)].c;
}
function thin<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  out.push(arr[arr.length - 1]);
  return out;
}

export function computeMetrics(trades: Trade[], curve: { t: number; equity: number }[], startEquity: number, intervalMs: number): Metrics {
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl <= 0);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const grossWin = sum(wins.map((t) => t.pnl)), grossLoss = -sum(losses.map((t) => t.pnl));
  let peak = -Infinity, maxDd = 0;
  for (const p of curve) { if (p.equity > peak) peak = p.equity; const dd = peak > 0 ? (peak - p.equity) / peak : 0; if (dd > maxDd) maxDd = dd; }
  const finalEquity = curve.length ? curve[curve.length - 1].equity : startEquity;
  const totalReturnPct = (finalEquity - startEquity) / startEquity;
  const rs = trades.map((t) => { const r = Math.abs(t.entryPrice - t.stopPrice) * t.qty; return r > 0 ? t.pnl / r : 0; });
  // daily returns for sharpe
  const daily = new Map<number, number>();
  for (const p of curve) daily.set(Math.floor(p.t / 86_400_000), p.equity);
  const eqs = [...daily.values()];
  const rets: number[] = [];
  for (let i = 1; i < eqs.length; i++) rets.push(eqs[i] / eqs[i - 1] - 1);
  const mean = rets.length ? sum(rets) / rets.length : 0;
  const sd = rets.length > 1 ? Math.sqrt(sum(rets.map((r) => (r - mean) ** 2)) / (rets.length - 1)) : 0;
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(365) : 0;
  const days = curve.length ? Math.max(1, (curve[curve.length - 1].t - curve[0].t) / 86_400_000) : 1;
  const annual = totalReturnPct * (365 / days);
  const exitReasons: Record<string, number> = {};
  for (const t of trades) { const k = t.reasonExit.replace(/:.*$/, "").replace(/ \(.*\)$/, ""); exitReasons[k] = (exitReasons[k] ?? 0) + 1; }
  return {
    trades: trades.length, wins: wins.length, losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    expectancy: trades.length ? sum(trades.map((t) => t.pnl)) / trades.length : 0,
    expectancyR: rs.length ? sum(rs) / rs.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownPct: maxDd, totalReturnPct, finalEquity,
    totalFees: sum(trades.map((t) => t.fees)), totalFunding: sum(trades.map((t) => t.funding)),
    longs: trades.filter((t) => t.side === "long").length, shorts: trades.filter((t) => t.side === "short").length,
    avgHoldHours: trades.length ? sum(trades.map((t) => (t.exitTime - t.entryTime) / 3_600_000)) / trades.length : 0,
    sharpe, calmar: maxDd > 0 ? annual / maxDd : 0, exitReasons,
  };
}

export function formatReport(r: BacktestResult): string {
  const m = r.metrics, n = r.metricsNoFees;
  const pct = (x: number) => (x * 100).toFixed(2) + "%";
  const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "inf");
  const row = (k: string, a: string, b: string) => `${k.padEnd(18)} ${a.padStart(12)} ${b.padStart(12)}`;
  const lines = [
    `=== ${r.label} ===`,
    `strategy ${r.params.name} | ${new Date(r.from).toISOString().slice(0, 10)} → ${new Date(r.to).toISOString().slice(0, 10)} | start equity ${r.startEquity}`,
    `lev ${r.risk.leverage}x | size ${pct(r.risk.sizeFraction)} | lookback ${r.params.lookback} | vol x${r.params.volumeMult} | R ${r.params.rMultiple} | trail ${r.params.trailAtrMult} | stopATR ${r.params.stopAtrMult} | trend ${r.params.trendFilter}`,
    row("", "with fees", "no fees"),
    row("trades", String(m.trades), String(n.trades)),
    row("win rate", pct(m.winRate), pct(n.winRate)),
    row("expectancy $", f2(m.expectancy), f2(n.expectancy)),
    row("expectancy R", f2(m.expectancyR), f2(n.expectancyR)),
    row("profit factor", f2(m.profitFactor), f2(n.profitFactor)),
    row("max drawdown", pct(m.maxDrawdownPct), pct(n.maxDrawdownPct)),
    row("total return", pct(m.totalReturnPct), pct(n.totalReturnPct)),
    row("final equity", f2(m.finalEquity), f2(n.finalEquity)),
    row("sharpe (daily)", f2(m.sharpe), f2(n.sharpe)),
    row("fees paid", f2(m.totalFees), "0"),
    row("funding net", f2(m.totalFunding), "0"),
    row("longs/shorts", `${m.longs}/${m.shorts}`, ""),
    row("avg hold (h)", f2(m.avgHoldHours), ""),
    `exits: ${Object.entries(m.exitReasons).map(([k, v]) => `${k}=${v}`).join(", ")}`,
  ];
  if (r.haltedAt) lines.push(`KILL SWITCH at ${new Date(r.haltedAt).toISOString()}: ${r.haltReason}`);
  if (r.dailyHalts) lines.push(`daily-loss halts: ${r.dailyHalts} (auto-resumed next UTC day in backtest; the live bot stays halted until manual reset)`);
  return lines.join("\n");
}
