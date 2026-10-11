import { config as dotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Load .env from the repo root (and cwd) without ever printing values. */
export function loadEnv(): void {
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "..", ".env")];
  for (const p of candidates) if (existsSync(p)) { dotenv({ path: p }); break; }
}

export function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1] ?? "";
  return def;
}
export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
export function parseDate(s: string | undefined, def: number): number {
  if (!s) return def;
  if (/^\d{13}$/.test(s)) return Number(s);
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`bad date: ${s}`);
  return t;
}
