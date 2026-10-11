import type { Trade } from "./types.js";

export interface MonteCarloResult {
  paths: number;
  /** final equity multiples at percentiles */
  p5: number; p25: number; p50: number; p75: number; p95: number;
  /** probability of a > 50% / > 90% drawdown at any point */
  pDd50: number; pDd90: number;
  medianMaxDd: number;
  /** probability of finishing below the starting equity */
  pLoss: number;
  /** average pnl per trade as a fraction of equity before the trade */
  meanTradePct: number;
}

/** Deterministic xorshift PRNG so results are reproducible. */
function rng(seed: number): () => number {
  let x = seed || 123456789;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 1_000_000) / 1_000_000; };
}

/**
 * Bootstrap the sequence of per-trade returns (pnl as a fraction of equity before the trade) to estimate the
 * distribution of outcomes over `horizonTrades` trades with full compounding. Captures fat tails and ruin risk that
 * a single historical path hides. Trades without equityBefore use pnl / startEquity.
 */
export function monteCarlo(trades: Trade[], startEquity: number, paths = 2000, horizonTrades?: number, seed = 42): MonteCarloResult | null {
  const rets = trades.map((t) => t.pnl / (t.equityBefore && t.equityBefore > 0 ? t.equityBefore : startEquity)).filter((r) => Number.isFinite(r) && r > -1);
  if (rets.length < 20) return null;
  const n = horizonTrades ?? rets.length;
  const rand = rng(seed);
  const finals: number[] = [], maxDds: number[] = [];
  let dd50 = 0, dd90 = 0, losses = 0;
  for (let p = 0; p < paths; p++) {
    let eq = 1, peak = 1, maxDd = 0;
    for (let i = 0; i < n; i++) {
      eq *= 1 + rets[Math.floor(rand() * rets.length)];
      if (eq > peak) peak = eq;
      const dd = (peak - eq) / peak;
      if (dd > maxDd) maxDd = dd;
      if (eq <= 0.01) { eq = 0; maxDd = 1; break; }
    }
    finals.push(eq); maxDds.push(maxDd);
    if (maxDd >= 0.5) dd50++;
    if (maxDd >= 0.9) dd90++;
    if (eq < 1) losses++;
  }
  finals.sort((a, b) => a - b); maxDds.sort((a, b) => a - b);
  const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.floor(f * arr.length))];
  return {
    paths, p5: q(finals, 0.05), p25: q(finals, 0.25), p50: q(finals, 0.5), p75: q(finals, 0.75), p95: q(finals, 0.95),
    pDd50: dd50 / paths, pDd90: dd90 / paths, medianMaxDd: q(maxDds, 0.5), pLoss: losses / paths,
    meanTradePct: rets.reduce((a, b) => a + b, 0) / rets.length,
  };
}
