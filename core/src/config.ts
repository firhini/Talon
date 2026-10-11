import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Interval, Mode, RiskConfig, StrategyParams } from "./types.js";

/** Repository root (two levels above core/dist or core/src). */
export const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
/** Relative DB paths are resolved against the repo root so bot and web always open the same file. */
export function resolveDbPath(p: string): string {
  return p === ":memory:" || isAbsolute(p) ? p : resolve(REPO_ROOT, p);
}

/** Hard ceiling enforced in code regardless of env. */
export const HARD_MAX_LEVERAGE = 10;
export const DEFAULT_UNIVERSE = ["BTC", "ETH", "SOL", "BNB", "HYPE"];

export interface FeeConfig {
  takerFeeBps: number;
  makerFeeBps: number;
  slippageBps: number;
  /** fallback hourly funding rate when no history is available */
  defaultHourlyFunding: number;
}

export interface AppConfig {
  mode: Mode;
  dbPath: string;
  universe: string[];
  interval: Interval;
  contextInterval: Interval;
  strategy: StrategyParams;
  risk: RiskConfig;
  fees: FeeConfig;
  paperStartEquity: number;
  pollIntervalMs: number;
  live: {
    confirm: boolean;
    privateKey: string | null;
    accountAddress: string | null;
    testnet: boolean;
  };
}

function num(env: NodeJS.ProcessEnv, key: string, def: number): number {
  const v = env[key];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Config ${key} must be a number, got "${v}"`);
  return n;
}
function bool(env: NodeJS.ProcessEnv, key: string, def: boolean): boolean {
  const v = env[key];
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}
function str(env: NodeJS.ProcessEnv, key: string, def: string): string {
  const v = env[key];
  return v === undefined || v === "" ? def : v;
}

export function defaultStrategyParams(): StrategyParams {
  return {
    name: "reclaim",
    lookback: 48,
    volumeMult: 1.5,
    volumeAvgN: 20,
    maxSetupBars: 12,
    maxChaseAtr: 1.0,
    stopAtrMult: 1.0,
    rMultiple: 3,
    trailAtrMult: 0,
    trailAfterR: 1,
    timeStopBars: 0,
    trendFilter: "none",
    trendEmaN: 50,
    exitLookback: 20,
    atrN: 14,
    allowLong: true,
    allowShort: true,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const modeRaw = str(env, "MODE", "paper").toLowerCase();
  if (!["backtest", "paper", "live"].includes(modeRaw)) throw new Error(`MODE must be backtest|paper|live, got "${modeRaw}"`);
  const mode = modeRaw as Mode;
  const d = defaultStrategyParams();
  const strategyName = str(env, "STRATEGY", d.name);
  if (strategyName !== "reclaim" && strategyName !== "donchian") throw new Error(`STRATEGY must be reclaim|donchian`);
  const trendFilter = str(env, "TREND_FILTER", d.trendFilter);
  if (trendFilter !== "none" && trendFilter !== "ema") throw new Error(`TREND_FILTER must be none|ema`);

  const strategy: StrategyParams = {
    name: strategyName,
    lookback: num(env, "LOOKBACK", d.lookback),
    volumeMult: num(env, "VOLUME_MULT", d.volumeMult),
    volumeAvgN: num(env, "VOLUME_AVG_N", d.volumeAvgN),
    maxSetupBars: num(env, "MAX_SETUP_BARS", d.maxSetupBars),
    maxChaseAtr: num(env, "MAX_CHASE_ATR", d.maxChaseAtr),
    stopAtrMult: num(env, "STOP_ATR_MULT", d.stopAtrMult),
    rMultiple: num(env, "R_MULTIPLE", d.rMultiple),
    trailAtrMult: num(env, "TRAIL_ATR_MULT", d.trailAtrMult),
    trailAfterR: num(env, "TRAIL_AFTER_R", d.trailAfterR),
    timeStopBars: num(env, "TIME_STOP_BARS", d.timeStopBars),
    trendFilter,
    trendEmaN: num(env, "TREND_EMA_N", d.trendEmaN),
    exitLookback: num(env, "EXIT_LOOKBACK", d.exitLookback),
    atrN: num(env, "ATR_N", d.atrN),
    allowLong: bool(env, "ALLOW_LONG", true),
    allowShort: bool(env, "ALLOW_SHORT", true),
  };

  const maxLeverage = Math.min(num(env, "MAX_LEVERAGE", 5), HARD_MAX_LEVERAGE);
  const leverage = Math.min(num(env, "LEVERAGE", 5), maxLeverage);
  const paperStartEquity = num(env, "PAPER_START_EQUITY", 1000);
  const maxAccountEquityRaw = env["MAX_ACCOUNT_EQUITY"];
  const risk: RiskConfig = {
    leverage,
    maxLeverage,
    sizeFraction: num(env, "SIZE_FRACTION", 0.2),
    compound: bool(env, "COMPOUND", false),
    baseEquity: paperStartEquity,
    hardStopRoe: num(env, "HARD_STOP_ROE", 0.4),
    dailyLossLimitPct: num(env, "DAILY_LOSS_LIMIT_PCT", 0.05),
    maxDrawdownPct: num(env, "MAX_DRAWDOWN_PCT", 0.15),
    minNotionalUsd: num(env, "MIN_NOTIONAL_USD", 10),
    maxAccountEquity: maxAccountEquityRaw ? Number(maxAccountEquityRaw) : null,
  };
  if (risk.sizeFraction <= 0 || risk.sizeFraction > 1) throw new Error("SIZE_FRACTION must be in (0,1]");
  if (leverage < 1) throw new Error("LEVERAGE must be >= 1");

  const universe = str(env, "UNIVERSE", DEFAULT_UNIVERSE.join(",")).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const interval = str(env, "CANDLE_INTERVAL", "15m") as Interval;
  const contextInterval = str(env, "CONTEXT_INTERVAL", "1h") as Interval;

  const cfg: AppConfig = {
    mode,
    dbPath: resolveDbPath(str(env, "DB_PATH", "./data/talon.db")),
    universe,
    interval,
    contextInterval,
    strategy,
    risk,
    fees: {
      takerFeeBps: num(env, "TAKER_FEE_BPS", 4.5),
      makerFeeBps: num(env, "MAKER_FEE_BPS", 1.5),
      slippageBps: num(env, "SLIPPAGE_BPS", 3),
      defaultHourlyFunding: num(env, "DEFAULT_HOURLY_FUNDING", 0.0000125),
    },
    paperStartEquity,
    pollIntervalMs: num(env, "POLL_INTERVAL_MS", 15000),
    live: {
      confirm: str(env, "LIVE_CONFIRM", "").toLowerCase() === "yes",
      privateKey: env["HL_PRIVATE_KEY"] || null,
      accountAddress: env["HL_ACCOUNT_ADDRESS"] || null,
      testnet: bool(env, "HL_TESTNET", false),
    },
  };
  return cfg;
}

/** Throws unless live mode is explicitly and completely configured. Never logs secrets. */
export function assertLiveAllowed(cfg: AppConfig): void {
  if (cfg.mode !== "live") return;
  const problems: string[] = [];
  if (!cfg.live.confirm) problems.push("LIVE_CONFIRM must be exactly 'yes'");
  if (cfg.risk.maxAccountEquity === null || !Number.isFinite(cfg.risk.maxAccountEquity) || cfg.risk.maxAccountEquity <= 0)
    problems.push("MAX_ACCOUNT_EQUITY must be a positive number");
  if (!cfg.live.privateKey || !/^0x[0-9a-fA-F]{64}$/.test(cfg.live.privateKey)) problems.push("HL_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key (API wallet)");
  if (!cfg.live.accountAddress || !/^0x[0-9a-fA-F]{40}$/.test(cfg.live.accountAddress)) problems.push("HL_ACCOUNT_ADDRESS must be the master account address (0x...)");
  if (problems.length) throw new Error(`Refusing to start LIVE mode:\n - ${problems.join("\n - ")}`);
}

/** Redact anything that looks like a key before logging. */
export function redact(s: string): string {
  return s.replace(/0x[0-9a-fA-F]{64}/g, "0x[REDACTED]");
}
