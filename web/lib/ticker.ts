import { HL_MAINNET } from "@talon/core";

/** Hyperliquid market ticker (metaAndAssetCtxs), cached server-side for ~10 s and shared by every client. */
export interface TickerRow {
  coin: string; mark: number; mid: number; oracle: number; prevDayPx: number; change24h: number;
  fundingHourly: number; fundingAnnual: number; openInterest: number; openInterestUsd: number; volume24hUsd: number; maxLeverage: number; premium: number;
}
export interface Ticker { t: number; stale: boolean; error: string | null; rows: TickerRow[] }

const TTL_MS = 10_000;
type Cache = { key: string; at: number; data: Ticker | null; inflight: Promise<Ticker> | null };
const g = globalThis as unknown as { __talonTicker?: Cache };

type Resp = [{ universe: { name: string; szDecimals: number; maxLeverage: number; isDelisted?: boolean }[] }, { funding: string; openInterest: string; prevDayPx: string; dayNtlVlm: string; premium: string; oraclePx: string; markPx: string; midPx?: string }[]];

async function fetchTicker(coins: string[]): Promise<Ticker> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6_000);
  try {
    const res = await fetch(`${HL_MAINNET}/info`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "metaAndAssetCtxs" }), signal: ctl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`Hyperliquid HTTP ${res.status}`);
    const [meta, ctxs] = (await res.json()) as Resp;
    const rows: TickerRow[] = [];
    meta.universe.forEach((u, i) => {
      if (!coins.includes(u.name) || u.isDelisted) return;
      const c = ctxs[i];
      if (!c) return;
      const mark = +c.markPx, prev = +c.prevDayPx, f = +c.funding, oi = +c.openInterest;
      rows.push({
        coin: u.name, mark, mid: +(c.midPx ?? c.markPx), oracle: +c.oraclePx, prevDayPx: prev, change24h: prev > 0 ? mark / prev - 1 : 0,
        fundingHourly: f, fundingAnnual: f * 24 * 365, openInterest: oi, openInterestUsd: oi * mark, volume24hUsd: +c.dayNtlVlm, maxLeverage: u.maxLeverage, premium: +c.premium,
      });
    });
    rows.sort((a, b) => coins.indexOf(a.coin) - coins.indexOf(b.coin));
    return { t: Date.now(), stale: false, error: null, rows };
  } finally { clearTimeout(timer); }
}

export async function getTicker(coins: string[]): Promise<Ticker> {
  const key = coins.join(",");
  const c = g.__talonTicker ?? (g.__talonTicker = { key, at: 0, data: null, inflight: null });
  if (c.key !== key) { c.key = key; c.at = 0; c.data = null; c.inflight = null; }
  const now = Date.now();
  if (c.data && now - c.at < TTL_MS) return c.data;
  if (!c.inflight) {
    c.inflight = fetchTicker(coins)
      .then((d) => { c.data = d; c.at = Date.now(); return d; })
      .catch((e: Error) => { const d: Ticker = { t: c.data?.t ?? now, stale: true, error: e.message, rows: c.data?.rows ?? [] }; c.data = d; c.at = Date.now(); return d; })
      .finally(() => { c.inflight = null; });
  }
  return c.inflight;
}
