import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { feeCost, hardStopPrice, type ApprovedOrder, type AppConfig, type AssetSpec, type HyperliquidInfo, type Position, type Side } from "@talon/core";
import { buildCloseOrder, buildEntryOrder, buildProtectiveOrders, type Executor, type Fill, type HlOrder } from "./executor.js";

type OrderStatus = { resting: { oid: number } } | { filled: { totalSz: string; avgPx: string; oid: number } } | { error: string };

/**
 * Real orders on Hyperliquid through the official-style SDK. The API (agent) wallet signs,
 * HL_ACCOUNT_ADDRESS is the master account whose funds are traded.
 * Invariant: a position is never left without a resting stop order.
 */
export class LiveExecutor implements Executor {
  readonly kind = "live" as const;
  private readonly exchange: ExchangeClient;
  readonly address: string;

  constructor(private readonly cfg: AppConfig, private readonly specs: Map<string, AssetSpec>, private readonly info: HyperliquidInfo, private readonly log: (s: string) => void) {
    if (!cfg.live.privateKey || !cfg.live.accountAddress) throw new Error("live executor needs HL_PRIVATE_KEY and HL_ACCOUNT_ADDRESS");
    const wallet = privateKeyToAccount(cfg.live.privateKey as `0x${string}`);
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
    const res = await this.exchange.order({ orders, grouping });
    return res.response.data.statuses as OrderStatus[];
  }

  async open(order: ApprovedOrder, mark: number, protect: (fillPx: number) => { stop: number; tp: number | null }): Promise<{ fill: Fill; stopOrderId: number | null; stop: number; tp: number | null }> {
    const spec = this.spec(order.coin);
    await this.exchange.updateLeverage({ asset: spec.assetIndex, isCross: false, leverage: order.leverage });
    const [st] = await this.place([buildEntryOrder(spec, order.side, order.qty, mark)]);
    if ("error" in st) throw new Error(`entry rejected: ${st.error}`);
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

  private async placeProtection(spec: AssetSpec, side: Side, qty: number, stop: number, tp: number | null): Promise<number> {
    const orders = buildProtectiveOrders(spec, side, qty, stop, tp);
    const sts = await this.place(orders, tp !== null ? "positionTpsl" : "na");
    const sl = sts[0];
    if (!("resting" in sl)) throw new Error(`stop order not resting: ${JSON.stringify(sl)}`);
    if (tp !== null && sts[1] && "error" in sts[1]) this.log(`warn: take-profit order rejected: ${sts[1].error} (stop is in place)`);
    return sl.resting.oid;
  }

  async updateStop(pos: Position, newStop: number): Promise<number | null> {
    const spec = this.spec(pos.coin);
    // place the new stop first, then cancel the old one, so the position is never unprotected
    const [st] = await this.place(buildProtectiveOrders(spec, pos.side, pos.qty, newStop, null));
    if (!("resting" in st)) throw new Error(`new stop not resting: ${JSON.stringify(st)}`);
    if (pos.stopOrderId) await this.exchange.cancel({ cancels: [{ a: spec.assetIndex, o: pos.stopOrderId }] }).catch((e) => this.log(`warn: cancel old stop failed: ${(e as Error).message}`));
    return st.resting.oid;
  }

  async close(pos: Position, mark: number, _reason: string): Promise<Fill> {
    const spec = this.spec(pos.coin);
    const fill = await this.marketClose(spec, pos.side, pos.qty, mark);
    await this.cancelAll(pos.coin);
    return fill;
  }

  private async marketClose(spec: AssetSpec, side: Side, qty: number, mark?: number): Promise<Fill> {
    const px = mark ?? (await this.info.allMids())[spec.coin];
    const [st] = await this.place([buildCloseOrder(spec, side, qty, px)]);
    if ("filled" in st) {
      const q = Number(st.filled.totalSz), p = Number(st.filled.avgPx);
      return { price: p, qty: q, fee: feeCost(q * p, this.cfg.fees.takerFeeBps), time: Date.now() };
    }
    throw new Error(`close did not fill: ${JSON.stringify(st)}`);
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

  /** Make sure an adopted/unknown position has a hard stop. */
  async ensureStop(coin: string, side: Side, qty: number, entryPx: number, leverage: number): Promise<number> {
    const existing = await this.findStopOrder(coin);
    if (existing) return existing;
    const stop = hardStopPrice(side, entryPx, leverage, this.cfg.risk.hardStopRoe);
    this.log(`placing missing hard stop for ${coin} at ${stop}`);
    return this.placeProtection(this.spec(coin), side, qty, stop, null);
  }

  /** Closing fills for a coin after a given time (used to record exchange-side exits). */
  async closingFills(coin: string, since: number): Promise<{ price: number; qty: number; fee: number; time: number; closedPnl: number }[]> {
    const fills = await this.info.userFills(this.address);
    return fills.filter((f) => f.coin === coin && f.time >= since && /close/i.test(f.dir)).map((f) => ({ price: +f.px, qty: +f.sz, fee: +f.fee, time: f.time, closedPnl: +f.closedPnl }));
  }
}
