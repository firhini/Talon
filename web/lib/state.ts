import {
  allSettings, getControl, listEvents, listTrades, loadBotState, loadLatestScan, loadPosition, PRESETS, roe, stopDistancePct, unrealizedPnl,
  type DB, type Position, type PresetId, type ScanRow, type Trade,
} from "@talon/core";
import { liveChecklist } from "./effective";
import type { DashMode } from "./mode";
import { drawdownSeries, thin, tradeStats, type TradeStats } from "./stats";
import { getSupervisor, type JobView, type ProcessView } from "./supervisor";

/** Bot is considered offline when its last heartbeat is older than this. */
export const OFFLINE_AFTER_MS = 90_000;
/** Equity curve: keep every minute row for this recent window ... */
const RECENT_FULL_RES_MS = 6 * 3_600_000;
/** ... and one row per bucket (the bucket's last sample) before that. Integer literal in SQL: better-sqlite3 binds JS numbers as REAL. */
const BUCKET_MS = 15 * 60_000;
const MAX_EQUITY_POINTS = 4000; // ~38 days at 15-min buckets plus the full-res window

export interface EquityPoint { t: number; equity: number; unrealized: number }

/**
 * Mark-to-market equity history for the chart: minute resolution for the last 6 h, 15-minute buckets before that,
 * newest MAX_EQUITY_POINTS rows. The bot writes one row per minute, so an unbucketed LIMIT would be a rolling ~33 h window.
 */
export function loadEquityCurve(db: DB, mode: DashMode, now = Date.now()): EquityPoint[] {
  const cut = now - RECENT_FULL_RES_MS;
  const rows = db.prepare(`
    SELECT t, equity, unrealized FROM equity WHERE mode=? AND t >= ?
    UNION ALL
    SELECT t, equity, unrealized FROM equity WHERE mode=? AND t < ?
      AND t IN (SELECT MAX(t) FROM equity WHERE mode=? AND t < ? GROUP BY t / ${BUCKET_MS})
    ORDER BY t DESC LIMIT ?`).all(mode, cut, mode, cut, mode, cut, MAX_EQUITY_POINTS) as EquityPoint[];
  return rows.reverse();
}

export interface BotInfo {
  strategy?: string; interval?: string; universe?: string[]; leverage?: number; sizeFraction?: number;
  dailyLossLimitPct?: number; maxDrawdownPct?: number; hardStopRoe?: number; mids?: Record<string, number>;
  cash?: number | null; lastCandle?: number | null; testnet?: boolean; baseEquity?: number; lastStatus?: string;
  /** pyramiding (exposed by the engine when the strategy adds units) */
  maxUnits?: number; nextAddPrice?: number | null; units?: number; preset?: string;
}

export interface BotView {
  status: string; lastTick: number; equity: number; dayStartEquity: number; peakEquity: number;
  halted: boolean; haltReason: string | null; startedAt: number; runId: string;
}

export interface PositionView extends Position {
  mark: number | null;
  notional: number | null;
  /** net unrealized = gross - fees + funding */
  unrealized: number | null;
  roe: number | null;
  stopDistancePct: number | null;
  tpDistancePct: number | null;
  /** risk-multiple of open profit vs initial risk */
  openR: number | null;
  /** liquidation-ish reference: price at which margin is gone (isolated, ignoring fees) */
  liqPrice: number | null;
  maxUnits: number | null;
  nextAddPrice: number | null;
}

export interface EventRow { id: number; t: number; level: string; msg: string }
export interface Pt { t: number; v: number }

export interface DashboardState {
  mode: DashMode;
  /** server time when the snapshot was built (ms) */
  now: number;
  offline: boolean;
  /** a bot in the other mode (paper <-> live) has a fresh heartbeat and status running */
  otherModeActive: boolean;
  bot: BotView | null;
  info: BotInfo | null;
  dayPnl: number | null;
  dayPnlPct: number | null;
  drawdownPct: number | null;
  position: PositionView | null;
  /** equity is mark-to-market (already includes unrealized); unrealized is informational */
  equity: EquityPoint[];
  drawdown: Pt[];
  /** earliest equity ever recorded for this mode (chart baseline); null without history */
  startEquity: number | null;
  scan: ScanRow[];
  /** most recent trades only (capped) — use tradeCount / realizedTotal for all-time figures */
  trades: Trade[];
  tradeCount: number;
  realizedTotal: number;
  events: EventRow[];
  /** dashboard command still waiting in the bot's single-slot queue (null once the bot has consumed it) */
  pendingCmd: string | null;
  stats: TradeStats;
  sparks: { equity: Pt[]; today: Pt[]; drawdown: Pt[]; realized: Pt[]; fees: Pt[]; funding: Pt[] };
  process: ProcessView;
  preset: { id: PresetId; name: string; tagline: string; riskLevel: number } | null;
  /** MODE the next bot start would use (settings/.env), independent of the view */
  effectiveMode: DashMode;
  testnet: boolean;
  live: { ready: boolean; problems: string[]; keySet: boolean; addressSet: boolean; maxEquitySet: boolean };
  jobs: { running: JobView | null; queued: number; recent: JobView[] };
  firstRun: boolean;
  candleCount: number;
  backtestCount: number;
  universe: string[];
}

export function buildPositionView(pos: Position | null, mids: Record<string, number> | undefined, info?: BotInfo | null): PositionView | null {
  if (!pos) return null;
  const mark = mids?.[pos.coin];
  const maxUnits = typeof info?.maxUnits === "number" ? info.maxUnits : null;
  const nextAddPrice = typeof info?.nextAddPrice === "number" ? info.nextAddPrice : null;
  const liq = pos.leverage > 0 ? (pos.side === "long" ? pos.entryPrice * (1 - 1 / pos.leverage) : pos.entryPrice * (1 + 1 / pos.leverage)) : null;
  if (mark === undefined || !Number.isFinite(mark) || mark <= 0) {
    return { ...pos, mark: null, notional: null, unrealized: null, roe: null, stopDistancePct: null, tpDistancePct: null, openR: null, liqPrice: liq, maxUnits, nextAddPrice };
  }
  const gross = unrealizedPnl(pos.side, pos.entryPrice, mark, pos.qty);
  const net = gross - pos.fees + pos.funding;
  const risk = Math.abs(pos.entryPrice - pos.initialStop) * pos.qty;
  return {
    ...pos,
    mark,
    notional: pos.qty * mark,
    unrealized: net,
    roe: roe(net, pos.margin),
    stopDistancePct: stopDistancePct(pos.side, mark, pos.stopPrice),
    tpDistancePct: pos.tpPrice ? -stopDistancePct(pos.side, mark, pos.tpPrice) : null,
    openR: risk > 0 ? gross / risk : null,
    liqPrice: liq, maxUnits, nextAddPrice,
  };
}

/** The mode a page shows by default: the running bot's mode, else the configured MODE, else paper. */
export function defaultModeFor(db: DB): DashMode {
  const p = getSupervisor().process();
  if (p.status === "running" && p.mode) return p.mode;
  const m = (allSettings(db).MODE ?? process.env.MODE ?? "paper").toLowerCase();
  return m === "live" ? "live" : "paper";
}
export function resolveMode(db: DB, raw: string | string[] | null | undefined): DashMode {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "paper" || v === "live" ? v : defaultModeFor(db);
}

export function candleCount(db: DB): number {
  return (db.prepare(`SELECT COUNT(*) n FROM candles`).get() as { n: number }).n;
}

export function buildState(db: DB, mode: DashMode, now = Date.now()): DashboardState {
  const bs = loadBotState(db, mode);
  const info = (bs?.info ?? null) as BotInfo | null;
  const bot: BotView | null = bs
    ? { status: bs.status, lastTick: bs.lastTick, equity: bs.equity, dayStartEquity: bs.dayStartEquity, peakEquity: bs.peakEquity, halted: bs.halted, haltReason: bs.haltReason, startedAt: bs.startedAt, runId: bs.runId }
    : null;
  const position = buildPositionView(loadPosition(db, mode), info?.mids, info);
  const equity = loadEquityCurve(db, mode, now);
  const first = db.prepare(`SELECT equity FROM equity WHERE mode=? ORDER BY t LIMIT 1`).get(mode) as { equity: number } | undefined;
  // bot_state.equity is already mark-to-market (paper: cash + net unrealized; live: Hyperliquid accountValue),
  // so it is used as-is: adding position.unrealized again would double-count the open PnL.
  const liveEquity = bot ? bot.equity : null;
  const dayPnl = bot && liveEquity !== null ? liveEquity - bot.dayStartEquity : null;
  const dayPnlPct = bot && dayPnl !== null && bot.dayStartEquity > 0 ? dayPnl / bot.dayStartEquity : null;
  const peak = bot ? Math.max(bot.peakEquity, liveEquity ?? 0) : null;
  const drawdownPct = bot && peak && liveEquity !== null ? Math.max(0, (peak - liveEquity) / peak) : null;
  const allTrades = listTrades(db, mode, 50_000);
  const stats = tradeStats(allTrades, now);
  const other: DashMode = mode === "paper" ? "live" : "paper";
  const ob = loadBotState(db, other);
  const settings = allSettings(db);
  const presetId = settings.STRATEGY_PRESET in PRESETS ? (settings.STRATEGY_PRESET as PresetId) : null;
  const preset = presetId ? PRESETS[presetId] : null;
  const sup = getSupervisor();
  const jobs = sup.jobs(8);
  const check = liveChecklist(db);
  const eqPts = equity.map((p) => ({ t: p.t, v: p.equity }));
  const drawdown = drawdownSeries(eqPts);
  const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
  const cumulative = (f: (t: Trade) => number) => { let a = 0; return [...allTrades].sort((x, y) => x.exitTime - y.exitTime).map((t) => { a += f(t); return { t: t.exitTime, v: a }; }); };
  const effMode = (settings.MODE ?? process.env.MODE ?? "paper").toLowerCase() === "live" ? "live" : "paper";
  const candles = candleCount(db);
  const universe = (settings.UNIVERSE ?? process.env.UNIVERSE ?? "BTC,ETH,SOL,BNB,HYPE").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  return {
    mode, now,
    offline: !bot || now - bot.lastTick > OFFLINE_AFTER_MS,
    otherModeActive: !!ob && now - ob.lastTick <= OFFLINE_AFTER_MS && ob.status === "running",
    bot, info, dayPnl, dayPnlPct, drawdownPct, position, equity, drawdown,
    startEquity: first?.equity ?? null,
    scan: loadLatestScan(db, mode),
    trades: allTrades.slice(0, 100),
    tradeCount: stats.n,
    realizedTotal: stats.net,
    events: listEvents(db, mode, 60),
    pendingCmd: getControl(db, `cmd:${mode}`),
    stats,
    sparks: {
      equity: thin(eqPts, 120),
      today: thin(eqPts.filter((p) => p.t >= dayStart).map((p) => ({ t: p.t, v: p.v - (bot?.dayStartEquity ?? p.v) })), 120),
      drawdown: thin(drawdown, 120),
      realized: thin(cumulative((t) => t.pnl), 120),
      fees: thin(cumulative((t) => t.fees), 120),
      funding: thin(cumulative((t) => t.funding), 120),
    },
    process: sup.process(),
    preset: preset ? { id: preset.id, name: preset.name, tagline: preset.tagline, riskLevel: preset.riskLevel } : null,
    effectiveMode: effMode,
    testnet: check.testnet,
    live: { ready: check.ready, problems: check.problems, keySet: check.keySet, addressSet: check.addressSet, maxEquitySet: check.maxEquitySet },
    jobs: { running: jobs.find((j) => j.status === "running") ?? null, queued: jobs.filter((j) => j.status === "queued").length, recent: jobs.slice(0, 5) },
    firstRun: candles === 0,
    candleCount: candles,
    backtestCount: (db.prepare(`SELECT COUNT(*) n FROM backtests`).get() as { n: number }).n,
    universe: info?.universe ?? universe,
  };
}
