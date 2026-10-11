import type { AssetSpec, Candle, Interval } from "../types.js";
import { sleep } from "./okx.js";

export const HL_MAINNET = "https://api.hyperliquid.xyz";
export const HL_TESTNET = "https://api.hyperliquid-testnet.xyz";

export class HyperliquidInfo {
  constructor(private readonly base: string = HL_MAINNET) {}

  private async post<T>(body: unknown, tries = 4): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(`${this.base}/info`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(`HL info HTTP ${res.status}`);
        return (await res.json()) as T;
      } catch (e) {
        lastErr = e;
        await sleep(400 * 2 ** i);
      }
    }
    throw lastErr;
  }

  /** Up to ~5000 most recent candles; CLOSED and open candles both included (last may be open). */
  async candles(coin: string, interval: Interval, from: number, to: number = Date.now()): Promise<Candle[]> {
    type Raw = { t: number; o: string; h: string; l: string; c: string; v: string };
    const raw = await this.post<Raw[]>({ type: "candleSnapshot", req: { coin, interval, startTime: from, endTime: to } });
    return raw.map((r) => ({ t: r.t, o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v }));
  }

  /** Perp metadata for the given coins (asset index, size decimals, max leverage). */
  async assetSpecs(coins: string[]): Promise<Map<string, AssetSpec>> {
    type Meta = { universe: { name: string; szDecimals: number; maxLeverage: number; isDelisted?: boolean }[] };
    const meta = await this.post<Meta>({ type: "meta" });
    const m = new Map<string, AssetSpec>();
    meta.universe.forEach((u, i) => {
      if (coins.includes(u.name) && !u.isDelisted) m.set(u.name, { coin: u.name, assetIndex: i, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage });
    });
    for (const c of coins) if (!m.has(c)) throw new Error(`coin ${c} not found on Hyperliquid`);
    return m;
  }

  /** Current hourly funding rate and mark price per coin. */
  async assetCtxs(coins: string[]): Promise<Map<string, { funding: number; markPx: number; midPx: number; openInterest: number }>> {
    type Resp = [{ universe: { name: string }[] }, { funding: string; markPx: string; midPx?: string; openInterest: string }[]];
    const [meta, ctxs] = await this.post<Resp>({ type: "metaAndAssetCtxs" });
    const m = new Map<string, { funding: number; markPx: number; midPx: number; openInterest: number }>();
    meta.universe.forEach((u, i) => {
      if (coins.includes(u.name)) m.set(u.name, { funding: +ctxs[i].funding, markPx: +ctxs[i].markPx, midPx: +(ctxs[i].midPx ?? ctxs[i].markPx), openInterest: +ctxs[i].openInterest });
    });
    return m;
  }

  async allMids(): Promise<Record<string, number>> {
    const raw = await this.post<Record<string, string>>({ type: "allMids" });
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) out[k] = +v;
    return out;
  }

  /** Historical hourly funding, paginated (500 per call), oldest-first. */
  async fundingHistory(coin: string, from: number, to: number = Date.now(), log: (s: string) => void = () => {}): Promise<{ t: number; rate: number }[]> {
    type Raw = { coin: string; fundingRate: string; premium: string; time: number };
    const out: { t: number; rate: number }[] = [];
    let start = from;
    for (let i = 0; i < 400; i++) {
      const raw = await this.post<Raw[]>({ type: "fundingHistory", coin, startTime: start, endTime: to });
      if (!raw.length) break;
      for (const r of raw) out.push({ t: r.time, rate: +r.fundingRate });
      const last = raw[raw.length - 1].time;
      if (last <= start || raw.length < 500) break;
      start = last + 1;
      if (i % 5 === 4) log(`  ${coin} funding: ${out.length} rows, at ${new Date(last).toISOString().slice(0, 10)}`);
      await sleep(120);
    }
    const seen = new Set<number>();
    return out.filter((r) => (seen.has(r.t) ? false : (seen.add(r.t), true))).sort((a, b) => a.t - b.t);
  }

  /** API (agent) wallets authorised for a master account. */
  async extraAgents(user: string): Promise<{ address: string; name: string; validUntil: number | null }[]> {
    return this.post({ type: "extraAgents", user });
  }
  /** Net funding paid/received (USDC) for a coin since `since`. */
  async fundingSince(user: string, coin: string, since: number): Promise<number> {
    type Row = { time: number; delta: { type: string; coin: string; usdc: string } };
    const rows = await this.post<Row[]>({ type: "userFunding", user, startTime: since });
    return rows.filter((r) => r.delta?.coin === coin && r.time >= since).reduce((s, r) => s + Number(r.delta.usdc), 0);
  }
  /** Account state for a user (equity, positions). */
  async clearinghouseState(user: string): Promise<ClearinghouseState> {
    return this.post<ClearinghouseState>({ type: "clearinghouseState", user });
  }
  async openOrders(user: string): Promise<{ coin: string; oid: number; side: string; sz: string; limitPx: string; orderType?: string; reduceOnly?: boolean; triggerPx?: string; isTrigger?: boolean }[]> {
    return this.post({ type: "frontendOpenOrders", user });
  }
  async userFills(user: string): Promise<{ coin: string; px: string; sz: string; side: string; time: number; fee: string; closedPnl: string; oid: number; dir: string }[]> {
    return this.post({ type: "userFills", user });
  }
}

export interface ClearinghouseState {
  marginSummary: { accountValue: string; totalNtlPos: string; totalRawUsd: string; totalMarginUsed: string };
  withdrawable: string;
  assetPositions: { type: string; position: { coin: string; szi: string; entryPx: string | null; leverage: { type: string; value: number }; liquidationPx: string | null; marginUsed: string; positionValue: string; unrealizedPnl: string; returnOnEquity: string } }[];
}
