import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Candle, Interval, Mode, Position, ScanRow, Trade } from "./types.js";

export type DB = Database.Database;

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: DB): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS candles (
    source TEXT NOT NULL, coin TEXT NOT NULL, interval TEXT NOT NULL, t INTEGER NOT NULL,
    o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL NOT NULL,
    PRIMARY KEY (source, coin, interval, t)
  );
  CREATE TABLE IF NOT EXISTS funding (
    coin TEXT NOT NULL, t INTEGER NOT NULL, rate REAL NOT NULL, PRIMARY KEY (coin, t)
  );
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT NOT NULL, run_id TEXT NOT NULL,
    coin TEXT NOT NULL, side TEXT NOT NULL, leverage REAL NOT NULL, qty REAL NOT NULL,
    entry_price REAL NOT NULL, entry_time INTEGER NOT NULL, exit_price REAL NOT NULL, exit_time INTEGER NOT NULL,
    stop_price REAL NOT NULL, tp_price REAL, gross_pnl REAL NOT NULL, fees REAL NOT NULL, funding REAL NOT NULL,
    pnl REAL NOT NULL, roe REAL NOT NULL, reason_entry TEXT NOT NULL, reason_exit TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS trades_mode_time ON trades(mode, exit_time);
  CREATE TABLE IF NOT EXISTS positions (
    mode TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS equity (
    mode TEXT NOT NULL, t INTEGER NOT NULL, equity REAL NOT NULL, unrealized REAL NOT NULL DEFAULT 0, run_id TEXT NOT NULL,
    PRIMARY KEY (mode, t)
  );
  CREATE TABLE IF NOT EXISTS scans (
    t INTEGER NOT NULL, coin TEXT NOT NULL, mode TEXT NOT NULL, price REAL NOT NULL, trend TEXT NOT NULL, trend_strength REAL NOT NULL,
    atr_pct REAL NOT NULL, volume_ratio REAL NOT NULL, level_high REAL NOT NULL, level_low REAL NOT NULL,
    dist_high_pct REAL NOT NULL, dist_low_pct REAL NOT NULL, regime TEXT NOT NULL, setup TEXT NOT NULL,
    PRIMARY KEY (mode, t, coin)
  );
  CREATE TABLE IF NOT EXISTS backtests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, label TEXT NOT NULL,
    params TEXT NOT NULL, metrics TEXT NOT NULL, equity_curve TEXT NOT NULL, trades TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS control (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, mode TEXT NOT NULL, level TEXT NOT NULL, msg TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bot_state (
    mode TEXT PRIMARY KEY, status TEXT NOT NULL, last_tick INTEGER NOT NULL, equity REAL NOT NULL,
    day_start_equity REAL NOT NULL, peak_equity REAL NOT NULL, halted INTEGER NOT NULL, halt_reason TEXT,
    started_at INTEGER NOT NULL, run_id TEXT NOT NULL, info TEXT
  );
  `);
}

// ---------- candles ----------
export function upsertCandles(db: DB, source: string, coin: string, interval: Interval, candles: Candle[]): number {
  const stmt = db.prepare(`INSERT OR REPLACE INTO candles(source,coin,interval,t,o,h,l,c,v) VALUES (?,?,?,?,?,?,?,?,?)`);
  const tx = db.transaction((rows: Candle[]) => { for (const r of rows) stmt.run(source, coin, interval, r.t, r.o, r.h, r.l, r.c, r.v); });
  tx(candles);
  return candles.length;
}
export function loadCandles(db: DB, source: string, coin: string, interval: Interval, from = 0, to = Number.MAX_SAFE_INTEGER): Candle[] {
  return db.prepare(`SELECT t,o,h,l,c,v FROM candles WHERE source=? AND coin=? AND interval=? AND t>=? AND t<=? ORDER BY t`).all(source, coin, interval, from, to) as Candle[];
}
export function candleRange(db: DB, source: string, coin: string, interval: Interval): { min: number; max: number; n: number } | null {
  const r = db.prepare(`SELECT MIN(t) min, MAX(t) max, COUNT(*) n FROM candles WHERE source=? AND coin=? AND interval=?`).get(source, coin, interval) as { min: number | null; max: number | null; n: number };
  return r.min === null || r.max === null ? null : { min: r.min, max: r.max, n: r.n };
}

// ---------- funding ----------
export function upsertFunding(db: DB, coin: string, rows: { t: number; rate: number }[]): void {
  const stmt = db.prepare(`INSERT OR REPLACE INTO funding(coin,t,rate) VALUES (?,?,?)`);
  db.transaction((rs: typeof rows) => { for (const r of rs) stmt.run(coin, r.t, r.rate); })(rows);
}
export function loadFunding(db: DB, coin: string, from = 0, to = Number.MAX_SAFE_INTEGER): { t: number; rate: number }[] {
  return db.prepare(`SELECT t, rate FROM funding WHERE coin=? AND t>=? AND t<=? ORDER BY t`).all(coin, from, to) as { t: number; rate: number }[];
}

// ---------- trades ----------
export function insertTrade(db: DB, tr: Trade): number {
  const r = db.prepare(`INSERT INTO trades(mode,run_id,coin,side,leverage,qty,entry_price,entry_time,exit_price,exit_time,stop_price,tp_price,gross_pnl,fees,funding,pnl,roe,reason_entry,reason_exit)
    VALUES (@mode,@runId,@coin,@side,@leverage,@qty,@entryPrice,@entryTime,@exitPrice,@exitTime,@stopPrice,@tpPrice,@grossPnl,@fees,@funding,@pnl,@roe,@reasonEntry,@reasonExit)`).run(tr);
  return Number(r.lastInsertRowid);
}
export function listTrades(db: DB, mode: Mode, limit = 200): Trade[] {
  return (db.prepare(`SELECT * FROM trades WHERE mode=? ORDER BY exit_time DESC LIMIT ?`).all(mode, limit) as Record<string, unknown>[]).map(rowToTrade);
}
function rowToTrade(r: Record<string, unknown>): Trade {
  return {
    id: r.id as number, mode: r.mode as Mode, runId: r.run_id as string, coin: r.coin as string, side: r.side as Trade["side"],
    leverage: r.leverage as number, qty: r.qty as number, entryPrice: r.entry_price as number, entryTime: r.entry_time as number,
    exitPrice: r.exit_price as number, exitTime: r.exit_time as number, stopPrice: r.stop_price as number, tpPrice: r.tp_price as number | null,
    grossPnl: r.gross_pnl as number, fees: r.fees as number, funding: r.funding as number, pnl: r.pnl as number, roe: r.roe as number,
    reasonEntry: r.reason_entry as string, reasonExit: r.reason_exit as string,
  };
}

// ---------- position / equity / state ----------
export function savePosition(db: DB, mode: Mode, pos: Position | null): void {
  if (!pos) db.prepare(`DELETE FROM positions WHERE mode=?`).run(mode);
  else db.prepare(`INSERT OR REPLACE INTO positions(mode,data,updated_at) VALUES (?,?,?)`).run(mode, JSON.stringify(pos), Date.now());
}
export function loadPosition(db: DB, mode: Mode): Position | null {
  const r = db.prepare(`SELECT data FROM positions WHERE mode=?`).get(mode) as { data: string } | undefined;
  return r ? (JSON.parse(r.data) as Position) : null;
}
export function recordEquity(db: DB, mode: Mode, t: number, equity: number, unrealized: number, runId: string): void {
  db.prepare(`INSERT OR REPLACE INTO equity(mode,t,equity,unrealized,run_id) VALUES (?,?,?,?,?)`).run(mode, t, equity, unrealized, runId);
}
export function loadEquity(db: DB, mode: Mode, limit = 2000): { t: number; equity: number; unrealized: number }[] {
  const rows = db.prepare(`SELECT t, equity, unrealized FROM equity WHERE mode=? ORDER BY t DESC LIMIT ?`).all(mode, limit) as { t: number; equity: number; unrealized: number }[];
  return rows.reverse();
}

export interface BotStateRow {
  mode: Mode; status: string; lastTick: number; equity: number; dayStartEquity: number; peakEquity: number;
  halted: boolean; haltReason: string | null; startedAt: number; runId: string; info: Record<string, unknown> | null;
}
export function saveBotState(db: DB, s: BotStateRow): void {
  db.prepare(`INSERT OR REPLACE INTO bot_state(mode,status,last_tick,equity,day_start_equity,peak_equity,halted,halt_reason,started_at,run_id,info)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(s.mode, s.status, s.lastTick, s.equity, s.dayStartEquity, s.peakEquity, s.halted ? 1 : 0, s.haltReason, s.startedAt, s.runId, s.info ? JSON.stringify(s.info) : null);
}
export function loadBotState(db: DB, mode: Mode): BotStateRow | null {
  const r = db.prepare(`SELECT * FROM bot_state WHERE mode=?`).get(mode) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    mode, status: r.status as string, lastTick: r.last_tick as number, equity: r.equity as number, dayStartEquity: r.day_start_equity as number,
    peakEquity: r.peak_equity as number, halted: !!r.halted, haltReason: (r.halt_reason as string | null) ?? null, startedAt: r.started_at as number,
    runId: r.run_id as string, info: r.info ? JSON.parse(r.info as string) : null,
  };
}

// ---------- scans ----------
export function saveScan(db: DB, mode: Mode, rows: ScanRow[]): void {
  const stmt = db.prepare(`INSERT OR REPLACE INTO scans(t,coin,mode,price,trend,trend_strength,atr_pct,volume_ratio,level_high,level_low,dist_high_pct,dist_low_pct,regime,setup)
    VALUES (@t,@coin,@mode,@price,@trend,@trendStrength,@atrPct,@volumeRatio,@levelHigh,@levelLow,@distHighPct,@distLowPct,@regime,@setup)`);
  db.transaction((rs: ScanRow[]) => { for (const r of rs) stmt.run({ ...r, mode }); })(rows);
}
export function loadLatestScan(db: DB, mode: Mode): ScanRow[] {
  const t = db.prepare(`SELECT MAX(t) t FROM scans WHERE mode=?`).get(mode) as { t: number | null };
  if (t.t === null) return [];
  return (db.prepare(`SELECT * FROM scans WHERE mode=? AND t=? ORDER BY coin`).all(mode, t.t) as Record<string, unknown>[]).map((r) => ({
    t: r.t as number, coin: r.coin as string, price: r.price as number, trend: r.trend as ScanRow["trend"], trendStrength: r.trend_strength as number,
    atrPct: r.atr_pct as number, volumeRatio: r.volume_ratio as number, levelHigh: r.level_high as number, levelLow: r.level_low as number,
    distHighPct: r.dist_high_pct as number, distLowPct: r.dist_low_pct as number, regime: r.regime as string, setup: r.setup as string,
  }));
}

// ---------- control / events ----------
export type ControlCommand = "start" | "pause" | "kill" | "reset";
export function setControl(db: DB, key: string, value: string): void {
  db.prepare(`INSERT OR REPLACE INTO control(key,value,updated_at) VALUES (?,?,?)`).run(key, value, Date.now());
}
export function getControl(db: DB, key: string): string | null {
  const r = db.prepare(`SELECT value FROM control WHERE key=?`).get(key) as { value: string } | undefined;
  return r?.value ?? null;
}
/** Dashboard enqueues a command; bot consumes it. */
export function enqueueCommand(db: DB, mode: Mode, cmd: ControlCommand): void {
  setControl(db, `cmd:${mode}`, cmd);
}
export function takeCommand(db: DB, mode: Mode): ControlCommand | null {
  const v = getControl(db, `cmd:${mode}`) as ControlCommand | null;
  if (v) db.prepare(`DELETE FROM control WHERE key=?`).run(`cmd:${mode}`);
  return v;
}
export function logEvent(db: DB, mode: Mode, level: "info" | "warn" | "error" | "trade", msg: string): void {
  db.prepare(`INSERT INTO events(t,mode,level,msg) VALUES (?,?,?,?)`).run(Date.now(), mode, level, msg);
}
export function listEvents(db: DB, mode: Mode, limit = 100): { id: number; t: number; level: string; msg: string }[] {
  return db.prepare(`SELECT id,t,level,msg FROM events WHERE mode=? ORDER BY id DESC LIMIT ?`).all(mode, limit) as { id: number; t: number; level: string; msg: string }[];
}

// ---------- backtests ----------
export interface BacktestRow { id: number; createdAt: number; label: string; params: unknown; metrics: unknown; equityCurve: unknown; trades: unknown }
export function saveBacktest(db: DB, label: string, params: unknown, metrics: unknown, equityCurve: unknown, trades: unknown): number {
  const r = db.prepare(`INSERT INTO backtests(created_at,label,params,metrics,equity_curve,trades) VALUES (?,?,?,?,?,?)`)
    .run(Date.now(), label, JSON.stringify(params), JSON.stringify(metrics), JSON.stringify(equityCurve), JSON.stringify(trades));
  return Number(r.lastInsertRowid);
}
export function listBacktests(db: DB, limit = 50): Omit<BacktestRow, "equityCurve" | "trades">[] {
  return (db.prepare(`SELECT id, created_at, label, params, metrics FROM backtests ORDER BY id DESC LIMIT ?`).all(limit) as Record<string, unknown>[])
    .map((r) => ({ id: r.id as number, createdAt: r.created_at as number, label: r.label as string, params: JSON.parse(r.params as string), metrics: JSON.parse(r.metrics as string) }));
}
export function getBacktest(db: DB, id: number): BacktestRow | null {
  const r = db.prepare(`SELECT * FROM backtests WHERE id=?`).get(id) as Record<string, unknown> | undefined;
  if (!r) return null;
  return { id: r.id as number, createdAt: r.created_at as number, label: r.label as string, params: JSON.parse(r.params as string), metrics: JSON.parse(r.metrics as string), equityCurve: JSON.parse(r.equity_curve as string), trades: JSON.parse(r.trades as string) };
}
