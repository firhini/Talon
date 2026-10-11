import { PRESETS, type MonteCarloResult, type Trade } from "@talon/core";

/** Shape written by bot/src/cli/backtest.ts (core Metrics + extras). JSON.stringify turns Infinity into null. */
export interface BtMetrics {
  trades: number; wins: number; losses: number; winRate: number; avgWin: number; avgLoss: number;
  expectancy: number; expectancyR: number; profitFactor: number | null; maxDrawdownPct: number; totalReturnPct: number;
  finalEquity: number; totalFees: number; totalFunding: number; longs: number; shorts: number; avgHoldHours: number;
  sharpe: number; calmar: number; exitReasons: Record<string, number>;
}
export interface BtMetricsFull extends BtMetrics {
  noFees?: BtMetrics; from?: number; to?: number; haltedAt?: number | null; haltReason?: string | null; dailyHalts?: number;
  /** Monte-Carlo bootstrap of the trade sequence (written by the backtest CLI when available) */
  mc?: MonteCarloResult | null;
}
export interface BtParams {
  name?: string; interval?: string; contextInterval?: string; lookback?: number; startEquity?: number; coins?: string[];
  risk?: { leverage?: number; maxLeverage?: number; sizeFraction?: number; riskPerTradePct?: number; dynamicLeverage?: boolean; hardStopRoe?: number; dailyLossLimitPct?: number; maxDrawdownPct?: number; compound?: boolean; minNotionalUsd?: number };
  fees?: { takerFeeBps?: number; makerFeeBps?: number; slippageBps?: number; defaultHourlyFunding?: number };
  [k: string]: unknown;
}
export interface BtSummary {
  id: number; createdAt: number; label: string; strategy: string; interval: string; trades: number; winRate: number;
  profitFactor: number | null; totalReturnPct: number; maxDrawdownPct: number; noFeeReturnPct: number | null; from: number | null; to: number | null;
  sharpe: number; expectancyR: number; finalEquity: number; totalFees: number; haltedAt: number | null; hasMc: boolean; presetId: string | null;
}

export function asMetrics(m: unknown): BtMetricsFull | null {
  return m && typeof m === "object" ? (m as BtMetricsFull) : null;
}
export function asParams(p: unknown): BtParams {
  return p && typeof p === "object" ? (p as BtParams) : {};
}
export function presetForLabel(label: string): string | null {
  for (const p of Object.values(PRESETS)) if (p.backtestLabel === label) return p.id;
  return null;
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
    sharpe: m?.sharpe ?? 0, expectancyR: m?.expectancyR ?? 0, finalEquity: m?.finalEquity ?? 0, totalFees: m?.totalFees ?? 0,
    haltedAt: m?.haltedAt ?? null, hasMc: !!m?.mc, presetId: presetForLabel(row.label),
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

/** Plain-language reading of a Monte-Carlo result. */
export function mcSentence(mc: MonteCarloResult): string {
  const x = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(v >= 2 ? 1 : 2));
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const one = (p: number) => (p <= 0 ? "never" : p >= 0.5 ? `${pct(p)} of the time` : `1 in ${Math.max(2, Math.round(1 / p))}`);
  return `In ${mc.paths.toLocaleString("en-US")} resampled trade sequences the median outcome was ×${x(mc.p50)} (5th–95th percentile ×${x(mc.p5)} to ×${x(mc.p95)}); ` +
    `${one(mc.pDd50)} the account lost more than half at some point, ruin (>90 % drawdown) in ${pct(mc.pDd90)}, and ${pct(mc.pLoss)} of the sequences ended below the starting equity.`;
}

/** Map a saved backtest's params back to the env the CLI reads, so a re-run reproduces it. */
export function paramsToEnv(p: BtParams): Record<string, string> {
  const s = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
  const env: Record<string, string | undefined> = {
    STRATEGY: s(p.name), CANDLE_INTERVAL: s(p.interval), CONTEXT_INTERVAL: s(p.contextInterval),
    LOOKBACK: s(p.lookback), VOLUME_MULT: s(p.volumeMult), VOLUME_AVG_N: s(p.volumeAvgN), MAX_SETUP_BARS: s(p.maxSetupBars), MAX_CHASE_ATR: s(p.maxChaseAtr),
    STOP_ATR_MULT: s(p.stopAtrMult), R_MULTIPLE: s(p.rMultiple), TRAIL_ATR_MULT: s(p.trailAtrMult), TRAIL_AFTER_R: s(p.trailAfterR), TIME_STOP_BARS: s(p.timeStopBars),
    TREND_FILTER: s(p.trendFilter), TREND_EMA_N: s(p.trendEmaN), EXIT_LOOKBACK: s(p.exitLookback), ATR_N: s(p.atrN), ALLOW_LONG: s(p.allowLong), ALLOW_SHORT: s(p.allowShort),
    MAX_UNITS: s(p.maxUnits), ADD_EVERY_ATR: s(p.addEveryAtr), REGIME_ER_MIN: s(p.regimeErMin), REGIME_ER_N: s(p.regimeErN),
    LEVERAGE: s(p.risk?.leverage), MAX_LEVERAGE: s(p.risk?.maxLeverage), SIZE_FRACTION: s(p.risk?.sizeFraction), RISK_PER_TRADE_PCT: s(p.risk?.riskPerTradePct),
    DYNAMIC_LEVERAGE: s(p.risk?.dynamicLeverage), COMPOUND: s(p.risk?.compound), HARD_STOP_ROE: s(p.risk?.hardStopRoe), DAILY_LOSS_LIMIT_PCT: s(p.risk?.dailyLossLimitPct),
    MAX_DRAWDOWN_PCT: s(p.risk?.maxDrawdownPct), MIN_NOTIONAL_USD: s(p.risk?.minNotionalUsd),
    TAKER_FEE_BPS: s(p.fees?.takerFeeBps), MAKER_FEE_BPS: s(p.fees?.makerFeeBps), SLIPPAGE_BPS: s(p.fees?.slippageBps), DEFAULT_HOURLY_FUNDING: s(p.fees?.defaultHourlyFunding),
    PAPER_START_EQUITY: s(p.startEquity), UNIVERSE: Array.isArray(p.coins) ? p.coins.join(",") : undefined,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v !== "[object Object]") out[k] = v;
  return out;
}
