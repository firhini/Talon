import type { Candle, Interval } from "../types.js";

const BAR: Record<Interval, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1Dutc" };

/** OKX USDT-margined perpetual symbol for a coin. */
export function okxInstId(coin: string): string {
  return `${coin}-USDT-SWAP`;
}

/**
 * Fetch confirmed candles from OKX public history endpoint (no key needed), oldest-first.
 * Paginates backwards from `to` until `from`. Volume = base-asset volume (volCcy).
 */
export async function fetchOkxCandles(coin: string, interval: Interval, from: number, to: number, log: (s: string) => void = () => {}): Promise<Candle[]> {
  const out: Candle[] = [];
  let after = to;
  let calls = 0;
  while (after > from) {
    const url = `https://www.okx.com/api/v5/market/history-candles?instId=${okxInstId(coin)}&bar=${BAR[interval]}&after=${after}&limit=100`;
    const res = await fetchWithRetry(url);
    const json = (await res.json()) as { code: string; msg: string; data: string[][] };
    if (json.code !== "0") throw new Error(`OKX error ${json.code}: ${json.msg}`);
    if (!json.data.length) break;
    let oldest = after;
    for (const r of json.data) {
      const t = Number(r[0]);
      if (r[8] !== "1") continue; // unconfirmed
      if (t < from) continue;
      out.push({ t, o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[6] });
      if (t < oldest) oldest = t;
    }
    const minT = Math.min(...json.data.map((r) => Number(r[0])));
    if (minT >= after) break;
    after = minT;
    calls++;
    if (calls % 25 === 0) log(`  ${coin} ${interval}: ${out.length} candles, back to ${new Date(after).toISOString().slice(0, 10)}`);
    await sleep(110); // OKX: 20 req / 2s
  }
  out.sort((a, b) => a.t - b.t);
  return dedupe(out);
}

async function fetchWithRetry(url: string, tries = 5): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(500 * 2 ** i);
    }
  }
  throw lastErr;
}
function dedupe(c: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const x of c) if (!out.length || out[out.length - 1].t !== x.t) out.push(x);
  return out;
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
