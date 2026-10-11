/**
 * Strategy presets selectable from the dashboard. A preset is a bundle of env-style settings.
 * Risk levels: 1 = conservative … 5 = can lose everything.
 */
export type PresetId = "donchian" | "reclaim" | "apex";

export interface Preset {
  id: PresetId;
  name: string;
  tagline: string;
  description: string;
  riskLevel: 1 | 2 | 3 | 4 | 5;
  warnings: string[];
  /** settings keys (same names as .env) applied when the preset is selected */
  env: Record<string, string>;
  /** backtest label the dashboard looks up for live numbers */
  backtestLabel: string;
}

export const PRESETS: Record<PresetId, Preset> = {
  donchian: {
    id: "donchian",
    name: "Talon Trend",
    tagline: "1h Donchian trend-following · 5× · 10 % size · 1 % risk per trade",
    description: "Close beyond the 48-bar (2-day) channel, 2 ATR stop, 2R take-profit, exit on the opposite 24-bar channel. Long and short, no filters. The configuration that was profitable in-sample and out-of-sample over 13 months. Thin edge, needs trends; expect 15–25 % drawdowns.",
    riskLevel: 2,
    warnings: ["Most of the historical profit came from one trending asset (HYPE).", "Five losing months out of fourteen in the backtest."],
    env: { STRATEGY: "donchian", CANDLE_INTERVAL: "1h", CONTEXT_INTERVAL: "4h", LOOKBACK: "48", EXIT_LOOKBACK: "24", STOP_ATR_MULT: "2", R_MULTIPLE: "2", VOLUME_MULT: "0", TRAIL_ATR_MULT: "0", TREND_FILTER: "none", LEVERAGE: "5", MAX_LEVERAGE: "5", SIZE_FRACTION: "0.1", RISK_PER_TRADE_PCT: "0.01", COMPOUND: "false", DYNAMIC_LEVERAGE: "false", MAX_UNITS: "1", MAX_DRAWDOWN_PCT: "0.25", DAILY_LOSS_LIMIT_PCT: "0.05", REGIME_ER_MIN: "0" },
    backtestLabel: "donchian-1h default",
  },
  reclaim: {
    id: "reclaim",
    name: "Reclaim (brief)",
    tagline: "15m volume-confirmed breakout reclaim · 5× · 10 % size",
    description: "The strategy from the original brief: break of the 48-candle level, pull back, close back beyond it on > 1.5× volume, stop at the pullback extreme, 3R target. Faithfully implemented and honestly negative after fees in the backtest (−6 % over 13 months). Kept for comparison and paper testing.",
    riskLevel: 2,
    warnings: ["Loses money after fees in every tested variant.", "Do not run live."],
    env: { STRATEGY: "reclaim", CANDLE_INTERVAL: "15m", CONTEXT_INTERVAL: "1h", LOOKBACK: "48", VOLUME_MULT: "1.5", STOP_ATR_MULT: "1", R_MULTIPLE: "3", TRAIL_ATR_MULT: "0", TREND_FILTER: "none", LEVERAGE: "5", MAX_LEVERAGE: "5", SIZE_FRACTION: "0.1", RISK_PER_TRADE_PCT: "0.01", COMPOUND: "false", DYNAMIC_LEVERAGE: "false", MAX_UNITS: "1", MAX_DRAWDOWN_PCT: "0.25", DAILY_LOSS_LIMIT_PCT: "0.05", REGIME_ER_MIN: "0" },
    backtestLabel: "spec reclaim-15m",
  },
  apex: {
    id: "apex",
    name: "APEX Moonshot",
    tagline: "15m momentum in the 1h trend · pyramiding up to 4 units · full compounding · dynamic leverage up to 40×",
    description: "Maximum-aggression trend compounding. Entries on 15m channel breakouts only in the direction of the 1h trend and only when the 4h market is trending (efficiency ratio), one unit at a time, adding a unit every ATR of profit up to four, all units trailed by a 3 ATR chandelier stop. Position size is a fixed risk fraction of CURRENT equity (compounding) and leverage is set per trade to the smallest value that keeps the stop inside the −40 % ROE hard stop, capped at the exchange maximum (40× BTC, 25× ETH, 20× SOL, 10× BNB/HYPE). The dashboard shows the Monte-Carlo distribution of outcomes for this preset: read the ruin probability before you fund it.",
    riskLevel: 5,
    warnings: ["Can lose the whole account; the kill switch is set to 60 % drawdown.", "Leverage up to 40×: a 1 % move against a BTC position is −40 % on that position's margin.", "Returns are path-dependent and dominated by a few big trends; most months will be flat or negative.", "Fees and funding at this trade frequency eat a large share of gross profit."],
    env: { STRATEGY: "apex", CANDLE_INTERVAL: "15m", CONTEXT_INTERVAL: "1h", LOOKBACK: "32", EXIT_LOOKBACK: "0", STOP_ATR_MULT: "2", R_MULTIPLE: "0", TRAIL_ATR_MULT: "3", TRAIL_AFTER_R: "0", VOLUME_MULT: "0", TREND_FILTER: "ema", TREND_EMA_N: "50", REGIME_ER_MIN: "0.3", LEVERAGE: "40", MAX_LEVERAGE: "40", SIZE_FRACTION: "1", RISK_PER_TRADE_PCT: "0.05", COMPOUND: "true", DYNAMIC_LEVERAGE: "true", MAX_UNITS: "4", ADD_EVERY_ATR: "1", MAX_DRAWDOWN_PCT: "0.6", DAILY_LOSS_LIMIT_PCT: "0.25", HARD_STOP_ROE: "0.4" },
    backtestLabel: "apex moonshot",
  },
};

export const PRESET_LIST: Preset[] = Object.values(PRESETS);

/** Settings keys the dashboard may edit (everything in .env.example except secrets). */
export const EDITABLE_SETTINGS: { key: string; label: string; type: "number" | "boolean" | "select" | "text"; options?: string[]; group: string; help: string }[] = [
  { key: "MODE", label: "Mode", type: "select", options: ["paper", "live"], group: "Mode", help: "paper = simulated fills at live prices; live = real orders (needs the live secrets and confirmation)" },
  { key: "UNIVERSE", label: "Universe", type: "text", group: "Market", help: "comma-separated Hyperliquid perps" },
  { key: "CANDLE_INTERVAL", label: "Candle interval", type: "select", options: ["15m", "1h", "4h"], group: "Market", help: "signal timeframe" },
  { key: "CONTEXT_INTERVAL", label: "Context interval", type: "select", options: ["1h", "4h", "1d"], group: "Market", help: "trend/regime timeframe" },
  { key: "STRATEGY", label: "Strategy", type: "select", options: ["donchian", "reclaim", "apex"], group: "Strategy", help: "" },
  { key: "LOOKBACK", label: "Breakout lookback", type: "number", group: "Strategy", help: "candles for the breakout level" },
  { key: "EXIT_LOOKBACK", label: "Exit lookback", type: "number", group: "Strategy", help: "donchian: opposite channel exit (0 = off)" },
  { key: "VOLUME_MULT", label: "Volume multiple", type: "number", group: "Strategy", help: "entry volume must exceed this × 20-candle average (0 = off)" },
  { key: "STOP_ATR_MULT", label: "Stop (ATR)", type: "number", group: "Strategy", help: "initial stop distance in ATR" },
  { key: "R_MULTIPLE", label: "Take profit (R)", type: "number", group: "Strategy", help: "0 = none" },
  { key: "TRAIL_ATR_MULT", label: "Trailing stop (ATR)", type: "number", group: "Strategy", help: "0 = off" },
  { key: "TRAIL_AFTER_R", label: "Trail after (R)", type: "number", group: "Strategy", help: "start trailing after this much open profit" },
  { key: "TREND_FILTER", label: "Trend filter", type: "select", options: ["none", "ema"], group: "Strategy", help: "context EMA direction filter" },
  { key: "TREND_EMA_N", label: "Trend EMA length", type: "number", group: "Strategy", help: "" },
  { key: "REGIME_ER_MIN", label: "Regime: min efficiency ratio", type: "number", group: "Strategy", help: "apex: 4h Kaufman efficiency ratio threshold (0 = off)" },
  { key: "MAX_UNITS", label: "Pyramiding units", type: "number", group: "Strategy", help: "1 = no pyramiding" },
  { key: "ADD_EVERY_ATR", label: "Add every (ATR)", type: "number", group: "Strategy", help: "profit distance between unit adds" },
  { key: "LEVERAGE", label: "Leverage", type: "number", group: "Risk", help: "requested leverage (capped by MAX_LEVERAGE and the exchange)" },
  { key: "MAX_LEVERAGE", label: "Max leverage", type: "number", group: "Risk", help: "hard cap in this config; code ceiling 50" },
  { key: "DYNAMIC_LEVERAGE", label: "Dynamic leverage", type: "boolean", group: "Risk", help: "pick the smallest leverage that keeps the stop inside the hard ROE stop" },
  { key: "SIZE_FRACTION", label: "Margin fraction", type: "number", group: "Risk", help: "margin per trade as a fraction of equity" },
  { key: "RISK_PER_TRADE_PCT", label: "Risk per trade", type: "number", group: "Risk", help: "max loss at the stop as a fraction of equity (0 = off)" },
  { key: "COMPOUND", label: "Compound", type: "boolean", group: "Risk", help: "size from current equity instead of starting equity" },
  { key: "HARD_STOP_ROE", label: "Hard stop (ROE)", type: "number", group: "Risk", help: "always-placed stop at this loss of margin" },
  { key: "DAILY_LOSS_LIMIT_PCT", label: "Daily loss limit", type: "number", group: "Risk", help: "flatten + halt for the day" },
  { key: "MAX_DRAWDOWN_PCT", label: "Max drawdown", type: "number", group: "Risk", help: "flatten + halt until reset" },
  { key: "PAPER_START_EQUITY", label: "Paper start equity", type: "number", group: "Paper", help: "" },
  { key: "TAKER_FEE_BPS", label: "Taker fee (bps)", type: "number", group: "Costs", help: "" },
  { key: "SLIPPAGE_BPS", label: "Slippage (bps)", type: "number", group: "Costs", help: "per side" },
  { key: "MAX_ACCOUNT_EQUITY", label: "Max account equity (live)", type: "number", group: "Live", help: "refuse to trade a bigger account" },
  { key: "HL_ACCOUNT_ADDRESS", label: "Hyperliquid account address", type: "text", group: "Live", help: "master account (0x…)" },
  { key: "HL_TESTNET", label: "Testnet", type: "boolean", group: "Live", help: "" },
];
/** Keys that are only ever written to .env, never to the database or the API. */
export const SECRET_KEYS = ["HL_PRIVATE_KEY"];
