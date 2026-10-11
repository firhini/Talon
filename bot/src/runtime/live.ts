import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { feeCost, hardStopPrice, type ApprovedOrder, type AppConfig, type AssetSpec, type HyperliquidInfo, type Position, type Side } from "@talon/core";
import { buildCloseOrder, buildEntryOrder, buildProtectiveOrders, type Executor, type Fill, type HlOrder } from "./executor.js";

type OrderStatus = { resting: { oid: number } } | { filled: { totalSz: string; avgPx: string; oid: number } } | { error: string } | "waitingForFill" | "waitingForTrigger";
const isObj = (st: OrderStatus): st is Exclude<OrderStatus, string> => typeof st === "object" && st !== null;

/**
 * Real orders on Hyperliquid through the official-style SDK. The API (agent) wallet signs,
 * HL_ACCOUNT_ADDRESS is the master account whose funds are traded.
 * Invariant: a position is never left without a resting stop order.
 */
export class LiveExecutor implements Executor {
  readonly kind = "live" as const;
  private readonly exchange: ExchangeClient;
  readonly address: string;
  readonly agentAddress: string;

  constructor(private readonly cfg: AppConfig, private readonly specs: Map<string, AssetSpec>, private readonly info: HyperliquidInfo, private readonly log: (s: string) => void) {
    if (!cfg.live.privateKey || !cfg.live.accountAddress) throw new Error("live executor needs HL_PRIVATE_KEY and HL_ACCOUNT_ADDRESS");
    const wallet = privateKeyToAccount(cfg.live.privateKey as `0x${string}`);
    this.agentAddress = wallet.address;
    const transport = new HttpTransport({ isTestnet: cfg.live.testnet });
    this.exchange = new ExchangeClient({ transport, wallet });
    this.address = cfg.live.accountAddress;
    this.log(`live executor: agent wallet ${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)} → account ${this.address.slice(0, 6)}…${this.address.slice(-4)} (${cfg.live.testnet ? "TESTNET" : "MAINNET"})`);
  }

  private spec(coin: string): AssetSpec {
    const s = this.specs.get(coin);
    if (!s) throw new Error(`no spec for ${coin}`);
    return s;
  }

  async equity(): Promise<number> {
    const st = await this.info.clearinghouseState(this.address);
    return Number(st.marginSummary.accountValue);
  }

  private async place(orders: HlOrder[], grouping: "na" | "positionTpsl" = "na"): Promise<OrderStatus[]> {
    // the SDK throws ApiRequestError when any status carries an error, so callers only see resting/filled/string statuses
    const res = await this.exchange.order({ orders, grouping });
    return res.response.data.statuses as OrderStatus[];
  }

  /** Verify the signing wallet is an authorised API agent of the master account (refuse to trade otherwise). */
  async verifyAgent(agentAddress: string): Promise<void> {
    const agents = await this.info.extraAgents(this.address);
    const me = agents.find((a) => a.address.toLowerCase() === agentAddress.toLowerCase());
    if (!me) throw new Error(`HL_PRIVATE_KEY is not an authorised API wallet of ${this.address} (approved agents: ${agents.length}). Generate one at app.hyperliquid.xyz/API.`);
    if (me.validUntil && me.validUntil < Date.now()) throw new Error(`API wallet "${me.name}" expired on ${new Date(me.validUntil).toISOString()}`);
    this.log(`API wallet "${me.name}" verified for ${this.address.slice(0, 6)}…${this.address.slice(-4)}${me.validUntil ? ` (valid until ${new Date(me.validUntil).toISOString().slice(0, 10)})` : ""}`);
  }

  async open(order: ApprovedOrder, mark: number, protect: (fillPx: number) => { stop: number; tp: number | null }): Promise<{ fill: Fill; stopOrderId: number | null; stop: number; tp: number | null }> {
    const spec = this.spec(order.coin);
    await this.exchange.updateLeverage({ asset: spec.assetIndex, isCross: false, leverage: order.leverage });
    const [st] = await this.place([buildEntryOrder(spec, order.side, order.qty, mark)]);
    if (!isObj(st) || "error" in st) throw new Error(`entry not filled: ${JSON.stringify(st)}`);
    if ("resting" in st) {
      await this.exchange.cancel({ cancels: [{ a: spec.assetIndex, o: st.resting.oid }] }).catch(() => {});
      throw new Error("entry IOC did not fill");
    }
    const qty = Number(st.filled.totalSz), price = Number(st.filled.avgPx);
    const fill: Fill = { price, qty, fee: feeCost(qty * price, this.cfg.fees.takerFeeBps), time: Date.now() };
    const { stop, tp } = protect(price);
    try {
      const stopOrderId = await this.placeProtection(spec, order.side, qty, stop, tp);
      return { fill, stopOrderId, stop, tp };
    } catch (e) {
      this.log(`!! failed to place stop for ${order.coin}: ${(e as Error).message} — closing position immediately`);
      await this.marketClose(spec, order.side, qty);
      throw e;
    }
  }

  /** Stop first (mandatory, its own request), then the take-profit (best effort). Returns the stop oid. */
  private async placeProtection(spec: AssetSpec, side: Side, qty: number, stop: number, tp: number | null): Promise<number> {
    const [slOrder, tpOrder] = buildProtectiveOrders(spec, side, qty, stop, tp);
    const [sl] = await this.place([slOrder]);
    const oid = await this.resolveTriggerOid(spec.coin, sl, "sl");
    if (oid === null) throw new Error(`stop order not resting: ${JSON.stringify(sl)}`);
    if (tpOrder) {
      try { await this.place([tpOrder]); } catch (e) { this.log(`warn: take-profit order rejected: ${(e as Error).message} (stop is in place)`); }
    }
    return oid;
  }

  /** Trigger orders may come back as "waitingForTrigger" without an oid; look it up on the book. */
  private async resolveTriggerOid(coin: string, st: OrderStatus, kind: "sl" | "tp"): Promise<number | null> {
    if (isObj(st) && "resting" in st) return st.resting.oid;
    if (isObj(st) && "filled" in st) return st.filled.oid;
    if (st === "waitingForTrigger" || st === "waitingForFill") {
      for (let i = 0; i < 3; i++) {
        const open = await this.info.openOrders(this.address);
        const mine = open.filter((o) => o.coin === coin && o.reduceOnly && (o.orderType ?? "").toLowerCase().includes(kind === "sl" ? "stop" : "take"));
        if (mine.length) return mine.sort((a, b) => b.oid - a.oid)[0].oid;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    return null;
  }

  async updateStop(pos: Position, newStop: number): Promise<number | null> {
    const spec = this.spec(pos.coin);
    // place the new stop first, then cancel the old one, so the position is never unprotected
    const [st] = await this.place(buildProtectiveOrders(spec, pos.side, pos.qty, newStop, null));
    const oid = await this.resolveTriggerOid(pos.coin, st, "sl");
    if (oid === null) throw new Error(`new stop not resting: ${JSON.stringify(st)}`);
    if (pos.stopOrderId) await this.exchange.cancel({ cancels: [{ a: spec.assetIndex, o: pos.stopOrderId }] }).catch((e) => this.log(`warn: cancel old stop failed: ${(e as Error).message}`));
    return oid;
  }

  /** Pyramiding: one more unit at market (IOC, not reduce-only). Leverage was set at entry. */
  async addUnit(order: ApprovedOrder, mark: number): Promise<Fill> {
    const spec = this.spec(order.coin);
    const [st] = await this.place([buildEntryOrder(spec, order.side, order.qty, mark)]);
    if (!isObj(st) || !("filled" in st)) {
      if (isObj(st) && "resting" in st) await this.exchange.cancel({ cancels: [{ a: spec.assetIndex, o: st.resting.oid }] }).catch(() => {});
      throw new Error(`add not filled: ${JSON.stringify(st)}`);
    }
    const qty = Number(st.filled.totalSz), price = Number(st.filled.avgPx);
    return { price, qty, fee: feeCost(qty * price, this.cfg.fees.takerFeeBps), time: Date.now() };
  }

  /** Place stop (+TP) for the position's total size, then cancel the previous protective orders. */
  async reprotect(pos: Position): Promise<number | null> {
    const spec = this.spec(pos.coin);
    const before = (await this.info.openOrders(this.address)).filter((o) => o.coin === pos.coin).map((o) => o.oid);
    const oid = await this.placeProtection(spec, pos.side, pos.qty, pos.stopPrice, pos.tpPrice);
    const stale = before.filter((o) => o !== oid);
    if (stale.length) await this.exchange.cancel({ cancels: stale.map((o) => ({ a: spec.assetIndex, o })) }).catch((e) => this.log(`warn: cancel stale protection failed: ${(e as Error).message}`));
    return oid;
  }

  /** Close the whole position; the stop is cancelled only after the exchange shows it flat. */
  async close(pos: Position, mark: number, _reason: string): Promise<Fill> {
    const spec = this.spec(pos.coin);
    const fill = await this.marketClose(spec, pos.side, pos.qty, mark);
    await this.cancelAll(pos.coin);
    return fill;
  }

  /** IOC close, retried with a widening price band until the full size is gone; throws (stop left in place) if a residual remains. */
  private async marketClose(spec: AssetSpec, side: Side, qty: number, mark?: number): Promise<Fill> {
    let remaining = qty, filledQty = 0, notional = 0;
    for (const band of [0.01, 0.02, 0.04]) {
      const px = mark && band === 0.01 ? mark : (await this.info.allMids())[spec.coin];
      const [st] = await this.place([buildCloseOrder(spec, side, remaining, px, band)]);
      if (isObj(st) && "filled" in st) {
        const q = Number(st.filled.totalSz), p = Number(st.filled.avgPx);
        filledQty += q; notional += q * p; remaining = Math.max(0, remaining - q);
      } else if (isObj(st) && "resting" in st) {
        await this.exchange.cancel({ cancels: [{ a: spec.assetIndex, o: st.resting.oid }] }).catch(() => {});
      }
      if (remaining <= 1e-12) break;
      const ex = await this.exchangePosition(spec.coin);
      if (!ex) { remaining = 0; break; }
      remaining = ex.qty;
    }
    if (remaining > 1e-12) throw new Error(`close left a residual ${remaining} ${spec.coin} on the exchange (stop order still resting)`);
    const avg = filledQty > 0 ? notional / filledQty : (mark ?? 0);
    return { price: avg, qty: filledQty || qty, fee: feeCost(notional || qty * avg, this.cfg.fees.takerFeeBps), time: Date.now() };
  }

  async cancelAll(coin: string): Promise<void> {
    const spec = this.spec(coin);
    const open = await this.info.openOrders(this.address);
    const mine = open.filter((o) => o.coin === coin);
    if (!mine.length) return;
    await this.exchange.cancel({ cancels: mine.map((o) => ({ a: spec.assetIndex, o: o.oid })) }).catch((e) => this.log(`warn: cancel failed: ${(e as Error).message}`));
  }

  async flattenAll(reason: string): Promise<void> {
    const st = await this.info.clearinghouseState(this.address);
    for (const ap of st.assetPositions) {
      const szi = Number(ap.position.szi);
      if (!szi || !this.specs.has(ap.position.coin)) continue;
      const spec = this.spec(ap.position.coin);
      this.log(`flatten ${ap.position.coin} ${szi} (${reason})`);
      await this.marketClose(spec, szi > 0 ? "long" : "short", Math.abs(szi));
    }
    for (const coin of this.specs.keys()) await this.cancelAll(coin);
  }

  /** Exchange view of a coin position, or null. */
  async exchangePosition(coin: string): Promise<{ qty: number; side: Side; entryPx: number; leverage: number; margin: number; unrealized: number } | null> {
    const st = await this.info.clearinghouseState(this.address);
    const ap = st.assetPositions.find((p) => p.position.coin === coin);
    if (!ap) return null;
    const szi = Number(ap.position.szi);
    if (!szi) return null;
    return { qty: Math.abs(szi), side: szi > 0 ? "long" : "short", entryPx: Number(ap.position.entryPx ?? 0), leverage: ap.position.leverage.value, margin: Number(ap.position.marginUsed), unrealized: Number(ap.position.unrealizedPnl) };
  }

  /** All non-zero positions in the universe. */
  async exchangePositions(): Promise<{ coin: string; qty: number; side: Side; entryPx: number; leverage: number; margin: number }[]> {
    const st = await this.info.clearinghouseState(this.address);
    return st.assetPositions.filter((p) => Number(p.position.szi) !== 0 && this.specs.has(p.position.coin)).map((p) => {
      const szi = Number(p.position.szi);
      return { coin: p.position.coin, qty: Math.abs(szi), side: szi > 0 ? "long" : "short", entryPx: Number(p.position.entryPx ?? 0), leverage: p.position.leverage.value, margin: Number(p.position.marginUsed) };
    });
  }

  /** Does a reduce-only stop exist for the coin? Returns its oid. */
  async findStopOrder(coin: string): Promise<number | null> {
    const open = await this.info.openOrders(this.address);
    const sl = open.find((o) => o.coin === coin && (o.orderType ?? "").toLowerCase().includes("stop"));
    return sl?.oid ?? null;
  }

  /** Make sure a position has a resting stop; places `stopPx` (or the hard ROE stop when unknown) if none exists. */
  async ensureStop(coin: string, side: Side, qty: number, entryPx: number, leverage: number, stopPx?: number): Promise<number> {
    const existing = await this.findStopOrder(coin);
    if (existing) return existing;
    const stop = stopPx ?? hardStopPrice(side, entryPx, leverage, this.cfg.risk.hardStopRoe);
    this.log(`placing missing stop for ${coin} at ${stop}`);
    return this.placeProtection(this.spec(coin), side, qty, stop, null);
  }

  /** Net funding on a coin since `since` (USDC, positive = received). */
  async fundingSince(coin: string, since: number): Promise<number> {
    return this.info.fundingSince(this.address, coin, since);
  }

  /** Closing fills for a coin after a given time (used to record exchange-side exits). */
  async closingFills(coin: string, since: number): Promise<{ price: number; qty: number; fee: number; time: number; closedPnl: number }[]> {
    const fills = await this.info.userFills(this.address);
    return fills.filter((f) => f.coin === coin && f.time >= since && /close|liquidat|>/i.test(f.dir)).map((f) => ({ price: +f.px, qty: +f.sz, fee: +f.fee, time: f.time, closedPnl: +f.closedPnl }));
  }
}
