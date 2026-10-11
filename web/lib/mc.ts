import type { MonteCarloResult } from "@talon/core";

/** Client-safe (type-only core import): Monte-Carlo wording shared by the strategy cards and the backtest page. */
/** Plain-language reading of a Monte-Carlo result. */
export function mcSentence(mc: MonteCarloResult): string {
  const x = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(v >= 2 ? 1 : 2));
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const one = (p: number) => (p <= 0 ? "never" : p >= 0.5 ? `${pct(p)} of the time` : `1 in ${Math.max(2, Math.round(1 / p))}`);
  return `In ${mc.paths.toLocaleString("en-US")} resampled trade sequences the median outcome was ×${x(mc.p50)} (5th–95th percentile ×${x(mc.p5)} to ×${x(mc.p95)}); ` +
    `${one(mc.pDd50)} the account lost more than half at some point, ruin (>90 % drawdown) in ${pct(mc.pDd90)}, and ${pct(mc.pLoss)} of the sequences ended below the starting equity.`;
}

