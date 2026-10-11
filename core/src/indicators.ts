import type { Candle } from "./types.js";

export function ema(values: number[], n: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length === 0) return out;
  const k = 2 / (n + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder ATR; atr[i] uses candles up to and including i. NaN until n candles. */
export function atr(candles: Candle[], n: number): number[] {
  const out: number[] = new Array(candles.length).fill(NaN);
  if (candles.length < 2) return out;
  let sum = 0;
  let prev = NaN;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr = Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
    if (i <= n) {
      sum += tr;
      if (i === n) { prev = sum / n; out[i] = prev; }
    } else {
      prev = (prev * (n - 1) + tr) / n;
      out[i] = prev;
    }
  }
  return out;
}

/** Highest high over candles[from..to] inclusive. */
export function highestHigh(candles: Candle[], from: number, to: number): number {
  let m = -Infinity;
  for (let i = Math.max(0, from); i <= to; i++) if (candles[i].h > m) m = candles[i].h;
  return m;
}
export function lowestLow(candles: Candle[], from: number, to: number): number {
  let m = Infinity;
  for (let i = Math.max(0, from); i <= to; i++) if (candles[i].l < m) m = candles[i].l;
  return m;
}
export function avgVolume(candles: Candle[], from: number, to: number): number {
  let s = 0, n = 0;
  for (let i = Math.max(0, from); i <= to; i++) { s += candles[i].v; n++; }
  return n ? s / n : 0;
}
