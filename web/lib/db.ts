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
