import {
  listEvents, listTrades, loadBotState, loadEquity, loadLatestScan, loadPosition, roe, stopDistancePct, unrealizedPnl,
  type DB, type Position, type ScanRow, type Trade,
} from "@talon/core";
import type { DashMode } from "./mode";

/** Bot is considered offline when its last heartbeat is older than this. */
export const OFFLINE_AFTER_MS = 90_000;

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
  bot: BotView | null;
  info: BotInfo | null;
  dayPnl: number | null;
  dayPnlPct: number | null;
  drawdownPct: number | null;
  position: PositionView | null;
  equity: { t: number; equity: number; unrealized: number }[];
  scan: ScanRow[];
  trades: Trade[];
  events: EventRow[];
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
  const equity = loadEquity(db, mode, 2000);
  // live equity includes open unrealized pnl so tiles and curve agree
  const liveEquity = bot ? bot.equity + (position?.unrealized ?? 0) : null;
  const dayPnl = bot && liveEquity !== null ? liveEquity - bot.dayStartEquity : null;
  const dayPnlPct = bot && dayPnl !== null && bot.dayStartEquity > 0 ? dayPnl / bot.dayStartEquity : null;
  const peak = bot ? Math.max(bot.peakEquity, liveEquity ?? 0) : null;
  const drawdownPct = bot && peak && liveEquity !== null ? Math.max(0, (peak - liveEquity) / peak) : null;
  return {
    mode, now,
    offline: !bot || now - bot.lastTick > OFFLINE_AFTER_MS,
    bot, info, dayPnl, dayPnlPct, drawdownPct, position, equity,
    scan: loadLatestScan(db, mode),
    trades: listTrades(db, mode, 100),
    events: listEvents(db, mode, 50),
  };
}
