import { assertLiveAllowed, HL_MAINNET, HL_TESTNET, HyperliquidInfo, loadBotState, loadConfig, openDb, redact, RiskGuard } from "@talon/core";
import { loadEnv } from "./env.js";
import { Engine, type Status } from "./runtime/engine.js";
import { LiveExecutor } from "./runtime/live.js";
import { PaperExecutor } from "./runtime/paper.js";

loadEnv();
const log = (s: string) => console.log(`${new Date().toISOString()} ${redact(s)}`);
const cfg = loadConfig();
if (cfg.mode === "backtest") { console.error("MODE=backtest: use `npm run backtest` instead"); process.exit(1); }
assertLiveAllowed(cfg);

const db = openDb(cfg.dbPath);
const info = new HyperliquidInfo(cfg.live.testnet ? HL_TESTNET : HL_MAINNET);
const specs = await info.assetSpecs(cfg.universe);
const saved = loadBotState(db, cfg.mode);
const savedInfo = (saved?.info ?? {}) as { cash?: number; baseEquity?: number; lastStatus?: string; flattenPending?: string | null };
const restored = {
  halted: saved?.halted ?? false, haltReason: saved?.haltReason ?? (savedInfo.flattenPending || null), peak: saved?.peakEquity, dayStart: saved?.dayStartEquity, lastTick: saved?.lastTick,
  status: (savedInfo.lastStatus === "paused" ? "paused" : "running") as Status,
};

log(`TALON ${cfg.mode.toUpperCase()} | ${cfg.strategy.name} on ${cfg.universe.join("/")} ${cfg.interval} (ctx ${cfg.contextInterval}) | ${cfg.risk.leverage}x, ${(cfg.risk.sizeFraction * 100).toFixed(0)}% of equity, hard stop ${(cfg.risk.hardStopRoe * 100).toFixed(0)}% ROE, daily loss ${(cfg.risk.dailyLossLimitPct * 100).toFixed(1)}%, max DD ${(cfg.risk.maxDrawdownPct * 100).toFixed(1)}%`);
if (restored.halted) log(`!! bot is HALTED from a previous run (${restored.haltReason}). Send 'reset' from the dashboard to resume.`);

let engine: Engine;
if (cfg.mode === "live") {
  const exec = new LiveExecutor(cfg, specs, info, log);
  await exec.verifyAgent(exec.agentAddress);
  const equity = await exec.equity();
  if (cfg.risk.maxAccountEquity !== null && equity > cfg.risk.maxAccountEquity) {
    console.error(`Refusing LIVE: account equity ${equity.toFixed(2)} exceeds MAX_ACCOUNT_EQUITY ${cfg.risk.maxAccountEquity}. Use a smaller account.`);
    process.exit(1);
  }
  // non-compounding sizing base: fixed at the first live start and persisted; a restart never re-bases it
  const baseEquity = typeof savedInfo.baseEquity === "number" && savedInfo.baseEquity > 0 ? savedInfo.baseEquity : equity;
  if (saved && typeof savedInfo.baseEquity !== "number") log(`warn: no persisted sizing base found; using current equity ${equity.toFixed(2)}`);
  const guard = new RiskGuard({ ...cfg.risk, baseEquity }, specs);
  log(`live account equity ${equity.toFixed(2)} USDC (sizing base ${baseEquity.toFixed(2)})`);
  engine = new Engine(cfg, db, guard, specs, info, exec, log, equity, restored);
} else {
  const cash = typeof savedInfo.cash === "number" ? savedInfo.cash : cfg.paperStartEquity;
  let engineRef: Engine | null = null;
  const exec = new PaperExecutor(cash, cfg.fees, () => (engineRef && engineRef.acct.position ? engineRef.mark(engineRef.acct.position.coin) : 0));
  const guard = new RiskGuard({ ...cfg.risk, baseEquity: cfg.paperStartEquity }, specs);
  engine = new Engine(cfg, db, guard, specs, info, exec, log, cash, restored);
  engineRef = engine;
  log(`paper cash ${cash.toFixed(2)} (start equity ${cfg.paperStartEquity})`);
}
await engine.start();
db.close();
