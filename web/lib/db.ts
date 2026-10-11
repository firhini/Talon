import { existsSync, statSync } from "node:fs";
import { openDb, resolveDbPath, type DB } from "@talon/core";

/** Process-wide cached connection (survives Next dev HMR via globalThis). Opened lazily on first request. */
const g = globalThis as unknown as { __talonDb?: { path: string; db: DB } };

export function dbPath(): string {
  return resolveDbPath(process.env.DB_PATH ?? "./data/talon.db");
}

export function getDb(): DB {
  const path = dbPath();
  if (g.__talonDb && g.__talonDb.path === path) return g.__talonDb.db;
  const db = openDb(path); // creates schema if the file is new, so an empty DB renders fine
  g.__talonDb = { path, db };
  return db;
}

// ---------- small read helpers the dashboard needs beyond @talon/core ----------
export interface BtHead { id: number; createdAt: number; label: string; params: unknown; metrics: unknown }
export function latestBacktestByLabel(db: DB, label: string): BtHead | null {
  const r = db.prepare(`SELECT id, created_at, label, params, metrics FROM backtests WHERE label=? ORDER BY id DESC LIMIT 1`).get(label) as Record<string, unknown> | undefined;
  return r ? { id: r.id as number, createdAt: r.created_at as number, label: r.label as string, params: JSON.parse(r.params as string), metrics: JSON.parse(r.metrics as string) } : null;
}
export function deleteBacktest(db: DB, id: number): boolean {
  return db.prepare(`DELETE FROM backtests WHERE id=?`).run(id).changes > 0;
}
export interface Coverage { source: string; coin: string; interval: string; n: number; min: number; max: number }
export function dataCoverage(db: DB): { candles: Coverage[]; funding: { coin: string; n: number; min: number; max: number }[] } {
  const candles = db.prepare(`SELECT source, coin, interval, COUNT(*) n, MIN(t) min, MAX(t) max FROM candles GROUP BY source, coin, interval ORDER BY coin, interval`).all() as Coverage[];
  const funding = db.prepare(`SELECT coin, COUNT(*) n, MIN(t) min, MAX(t) max FROM funding GROUP BY coin ORDER BY coin`).all() as { coin: string; n: number; min: number; max: number }[];
  return { candles, funding };
}
export function dbSizeBytes(): number {
  const p = dbPath();
  let n = 0;
  for (const f of [p, `${p}-wal`]) if (existsSync(f)) n += statSync(f).size;
  return n;
}
export function tableCounts(db: DB): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of ["candles", "funding", "trades", "equity", "scans", "backtests", "events", "jobs", "settings"]) out[t] = (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
  return out;
}
