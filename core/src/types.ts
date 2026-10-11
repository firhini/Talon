export type Mode = "backtest" | "paper" | "live";
export type Side = "long" | "short";
export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface Candle {
  /** open time, ms UTC */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** base-asset volume */
  v: number;
}

export interface AssetSpec {
  coin: string;
  /** Hyperliquid asset index (for order placement) */
  assetIndex: number;
  szDecimals: number;
  maxLeverage: number;
}

export interface StrategyParams {
  name: "reclaim" | "donchian";
  /** breakout lookback (candles) */
  lookback: number;
  /** volume must exceed volumeMult * avg(volume over volumeAvgN) */
  volumeMult: number;
  volumeAvgN: number;
  /** max candles between initial breakout and reclaim close */
  maxSetupBars: number;
  /** reclaim close must be within this many ATR of the level (never chase) */
  maxChaseAtr: number;
  /** stop distance floor in ATR units (structure stop is widened to this if tighter) */
  stopAtrMult: number;
  /** take-profit R multiple (0 = none) */
  rMultiple: number;
  /** trailing stop: 0 = off, else ATR multiple (chandelier from best close) */
  trailAtrMult: number;
  /** activate trailing only after this many R of open profit */
  trailAfterR: number;
  /** time stop in candles, 0 = off */
  timeStopBars: number;
  /** context trend filter */
  trendFilter: "none" | "ema";
  trendEmaN: number;
  /** donchian: exit channel length */
  exitLookback: number;
  atrN: number;
  allowLong: boolean;
  allowShort: boolean;
}

export interface EntrySignal {
  coin: string;
  side: Side;
  /** reference price (close of signal candle) */
  refPrice: number;
  /** structural stop price (before leverage/ROE clamp) */
  stopPrice: number;
  /** take-profit price or null */
  tpPrice: number | null;
  atr: number;
  level: number;
  volumeRatio: number;
  reason: string;
  /** signal candle open time */
  t: number;
}

export interface ManageAction {
  /** new stop price (only ever tightens) */
  newStop?: number;
  /** request full exit at market */
  exit?: { reason: string };
}

export interface Position {
  coin: string;
  side: Side;
  qty: number;
  entryPrice: number;
  entryTime: number;
  leverage: number;
  /** margin committed at entry (USD) */
  margin: number;
  stopPrice: number;
  tpPrice: number | null;
  initialStop: number;
  atr: number;
  bestPrice: number;
  barsHeld: number;
  reasonEntry: string;
  /** accumulated funding paid (negative = paid) */
  funding: number;
  /** fees paid so far (entry) */
  fees: number;
  /** exchange stop order id in live mode */
  stopOrderId?: number | null;
}

export interface Trade {
  id?: number;
  mode: Mode;
  runId: string;
  coin: string;
  side: Side;
  leverage: number;
  qty: number;
  entryPrice: number;
  entryTime: number;
  exitPrice: number;
  exitTime: number;
  stopPrice: number;
  tpPrice: number | null;
  /** gross pnl before fees and funding */
  grossPnl: number;
  fees: number;
  funding: number;
  /** net pnl = gross - fees + funding */
  pnl: number;
  /** net pnl / margin */
  roe: number;
  reasonEntry: string;
  reasonExit: string;
}

export interface AccountState {
  equity: number;
  /** equity at start of current UTC day */
  dayStartEquity: number;
  /** peak equity since (re)start */
  peakEquity: number;
  /** realized pnl today */
  dayPnl: number;
  position: Position | null;
  halted: boolean;
  haltReason: string | null;
}

export interface RiskConfig {
  leverage: number;
  /** hard ceiling, never above HARD_MAX_LEVERAGE */
  maxLeverage: number;
  sizeFraction: number;
  /** optional cap: risk at most this fraction of equity between entry and stop (0 = off); never increases size */
  riskPerTradePct: number;
  compound: boolean;
  /** base equity used for sizing when compounding is off */
  baseEquity: number;
  hardStopRoe: number;
  dailyLossLimitPct: number;
  maxDrawdownPct: number;
  minNotionalUsd: number;
  /** live only: refuse to trade if equity exceeds this */
  maxAccountEquity: number | null;
}

export interface OrderIntent {
  coin: string;
  side: Side;
  refPrice: number;
  stopPrice: number;
  tpPrice: number | null;
  leverage: number;
  reason: string;
}

export interface ApprovedOrder {
  readonly __approved: true;
  coin: string;
  side: Side;
  qty: number;
  notional: number;
  margin: number;
  leverage: number;
  /** stop price after rounding and ROE clamp */
  stopPrice: number;
  tpPrice: number | null;
  refPrice: number;
  reason: string;
}

export interface ScanRow {
  t: number;
  coin: string;
  price: number;
  trend: "up" | "down" | "flat";
  trendStrength: number;
  atrPct: number;
  volumeRatio: number;
  levelHigh: number;
  levelLow: number;
  distHighPct: number;
  distLowPct: number;
  regime: string;
  setup: string;
}
