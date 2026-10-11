import type { Candle } from "../src/types.js";

/** Flat, low-volume base candles. */
export function baseCandles(n: number, price = 100, vol = 100, start = 0, range = 1): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const t = start + i * 900_000;
    const wob = ((i % 5) - 2) * 0.1;
    out.push({ t, o: price + wob, h: price + wob + range / 2, l: price + wob - range / 2, c: price + wob, v: vol });
  }
  return out;
}
export function candle(prev: Candle, o: number, h: number, l: number, c: number, v: number): Candle {
  return { t: prev.t + 900_000, o, h, l, c, v };
}
