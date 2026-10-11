import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { REPO_ROOT, SECRET_KEYS } from "@talon/core";

/**
 * Minimal .env reader/writer. The repo-root .env is the only place secrets live; the dashboard never reads
 * them back except as "set / not set". TALON_ENV_FILE overrides the path (tests point it at a scratch file).
 */
export function envFilePath(): string {
  const p = process.env.TALON_ENV_FILE;
  if (p && p.trim()) return isAbsolute(p) ? p : resolve(REPO_ROOT, p);
  return resolve(REPO_ROOT, ".env");
}
export function envExamplePath(): string {
  return resolve(REPO_ROOT, ".env.example");
}

/** KEY=VALUE lines; `#` comments; quotes stripped; an unquoted value's trailing ` # comment` is removed (dotenv semantics). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1);
    else if (v.startsWith("#")) v = ""; // `KEY=   # comment` → empty
    else { const h = v.search(/\s#/); if (h >= 0) v = v.slice(0, h).trim(); }
    out[m[1]] = v;
  }
  return out;
}

export function readEnvFile(path = envFilePath()): Record<string, string> {
  try { return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {}; } catch { return {}; }
}
/** Documented defaults (every key in .env.example with a value). */
export function readEnvExample(): Record<string, string> {
  return readEnvFile(envExamplePath());
}

/** Create the .env file from .env.example when it does not exist yet (the launcher does the same). */
export function ensureEnvFile(path = envFilePath()): void {
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  const ex = envExamplePath();
  writeFileSync(path, existsSync(ex) ? readFileSync(ex, "utf8") : "# TALON configuration\nMODE=paper\n", { mode: 0o600 });
}

/**
 * Set (or remove, with null) one key in the env file, keeping every other line, comment and order intact.
 * Written atomically (tmp + rename) with 0600 permissions.
 */
export function writeEnvKey(key: string, value: string | null, path = envFilePath()): void {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error("bad env key");
  if (value !== null && /[\r\n]/.test(value)) throw new Error("value must be a single line");
  ensureEnvFile(path);
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
  let done = false;
  const out: string[] = [];
  for (const line of lines) {
    if (re.test(line)) {
      if (done || value === null) continue; // drop duplicates / removed key
      out.push(`${key}=${value}`); done = true;
    } else out.push(line);
  }
  if (!done && value !== null) {
    if (out.length && out[out.length - 1] !== "") out.push("");
    out.push(`${key}=${value}`);
  }
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, out.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
  renameSync(tmp, path);
}

/** Which secrets are present in the env file (never their values). */
export function secretStatus(path = envFilePath()): Record<string, boolean> {
  const env = readEnvFile(path);
  const out: Record<string, boolean> = {};
  for (const k of SECRET_KEYS) out[k] = k === "HL_PRIVATE_KEY" ? isPrivateKey(env[k]) : typeof env[k] === "string" && env[k].trim() !== "";
  return out;
}

export function isPrivateKey(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}
export function isAddress(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}
