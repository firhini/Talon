import {
  getControl, listEvents, listTrades, loadBotState, loadLatestScan, loadPosition, roe, stopDistancePct, unrealizedPnl,
  type DB, type Position, type ScanRow, type Trade,
} from "@talon/core";
import type { DashMode } from "./mode";

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
  cash?: number | null; lastCandle?: number | null; testnet?: boolean;
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
}

export interface EventRow { id: number; t: number; level: string; msg: string }

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
}

export function buildPositionView(pos: Position | null, mids: Record<string, number> | undefined): PositionView | null {
  if (!pos) return null;
  const mark = mids?.[pos.coin];
  if (mark === undefined || !Number.isFinite(mark) || mark <= 0) {
    return { ...pos, mark: null, notional: null, unrealized: null, roe: null, stopDistancePct: null, tpDistancePct: null, openR: null };
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
  };
}

export function buildState(db: DB, mode: DashMode, now = Date.now()): DashboardState {
  const bs = loadBotState(db, mode);
  const info = (bs?.info ?? null) as BotInfo | null;
  const bot: BotView | null = bs
    ? { status: bs.status, lastTick: bs.lastTick, equity: bs.equity, dayStartEquity: bs.dayStartEquity, peakEquity: bs.peakEquity, halted: bs.halted, haltReason: bs.haltReason, startedAt: bs.startedAt, runId: bs.runId }
    : null;
  const position = buildPositionView(loadPosition(db, mode), info?.mids);
  const equity = loadEquityCurve(db, mode, now);
  const first = db.prepare(`SELECT equity FROM equity WHERE mode=? ORDER BY t LIMIT 1`).get(mode) as { equity: number } | undefined;
  // bot_state.equity is already mark-to-market (paper: cash + net unrealized; live: Hyperliquid accountValue),
  // so it is used as-is: adding position.unrealized again would double-count the open PnL.
  const liveEquity = bot ? bot.equity : null;
  const dayPnl = bot && liveEquity !== null ? liveEquity - bot.dayStartEquity : null;
  const dayPnlPct = bot && dayPnl !== null && bot.dayStartEquity > 0 ? dayPnl / bot.dayStartEquity : null;
  const peak = bot ? Math.max(bot.peakEquity, liveEquity ?? 0) : null;
  const drawdownPct = bot && peak && liveEquity !== null ? Math.max(0, (peak - liveEquity) / peak) : null;
  const totals = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(pnl), 0) s FROM trades WHERE mode=?`).get(mode) as { n: number; s: number };
  const other: DashMode = mode === "paper" ? "live" : "paper";
  const ob = loadBotState(db, other);
  return {
    mode, now,
    offline: !bot || now - bot.lastTick > OFFLINE_AFTER_MS,
    otherModeActive: !!ob && now - ob.lastTick <= OFFLINE_AFTER_MS && ob.status === "running",
    bot, info, dayPnl, dayPnlPct, drawdownPct, position, equity,
    startEquity: first?.equity ?? null,
    scan: loadLatestScan(db, mode),
    trades: listTrades(db, mode, 100),
    tradeCount: totals.n,
    realizedTotal: totals.s,
    events: listEvents(db, mode, 50),
    pendingCmd: getControl(db, `cmd:${mode}`),
  };
}
