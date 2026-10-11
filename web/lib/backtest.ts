import type { Trade } from "@talon/core";

/** Shape written by bot/src/cli/backtest.ts (core Metrics + extras). JSON.stringify turns Infinity into null. */
export interface BtMetrics {
  trades: number; wins: number; losses: number; winRate: number; avgWin: number; avgLoss: number;
  expectancy: number; expectancyR: number; profitFactor: number | null; maxDrawdownPct: number; totalReturnPct: number;
  finalEquity: number; totalFees: number; totalFunding: number; longs: number; shorts: number; avgHoldHours: number;
  sharpe: number; calmar: number; exitReasons: Record<string, number>;
}
export interface BtMetricsFull extends BtMetrics {
  noFees?: BtMetrics; from?: number; to?: number; haltedAt?: number | null; haltReason?: string | null; dailyHalts?: number;
}
export interface BtParams {
  name?: string; interval?: string; contextInterval?: string; lookback?: number; startEquity?: number; coins?: string[];
  risk?: { leverage?: number; sizeFraction?: number; hardStopRoe?: number; dailyLossLimitPct?: number; maxDrawdownPct?: number; compound?: boolean };
  fees?: { takerFeeBps?: number; makerFeeBps?: number; slippageBps?: number; defaultHourlyFunding?: number };
  [k: string]: unknown;
}
export interface BtSummary {
  id: number; createdAt: number; label: string; strategy: string; interval: string; trades: number; winRate: number;
  profitFactor: number | null; totalReturnPct: number; maxDrawdownPct: number; noFeeReturnPct: number | null; from: number | null; to: number | null;
}

export function asMetrics(m: unknown): BtMetricsFull | null {
  return m && typeof m === "object" ? (m as BtMetricsFull) : null;
}
export function asParams(p: unknown): BtParams {
  return p && typeof p === "object" ? (p as BtParams) : {};
}

export function summarize(row: { id: number; createdAt: number; label: string; params: unknown; metrics: unknown }): BtSummary {
  const m = asMetrics(row.metrics), p = asParams(row.params);
  return {
    id: row.id, createdAt: row.createdAt, label: row.label,
    // guard: some sweep rows stored an object under `interval` — never print "[object Object]"
    strategy: typeof p.name === "string" ? p.name : "?", interval: typeof p.interval === "string" ? p.interval : "?",
    trades: m?.trades ?? 0, winRate: m?.winRate ?? 0, profitFactor: m?.profitFactor ?? null,
    totalReturnPct: m?.totalReturnPct ?? 0, maxDrawdownPct: m?.maxDrawdownPct ?? 0,
    noFeeReturnPct: m?.noFees?.totalReturnPct ?? null, from: m?.from ?? null, to: m?.to ?? null,
  };
}

/** Rebuild a no-fee equity curve by cumulating gross pnl per trade from the start equity. */
export function noFeeCurve(trades: Trade[], startEquity: number, startT: number | null): { t: number; equity: number }[] {
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  const out: { t: number; equity: number }[] = [];
  if (startT !== null) out.push({ t: startT, equity: startEquity });
  let eq = startEquity;
  for (const t of sorted) { eq += t.grossPnl; out.push({ t: t.exitTime, equity: eq }); }
  return out;
}
