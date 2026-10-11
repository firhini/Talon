import { allSettings, EDITABLE_SETTINGS, PRESETS, SECRET_KEYS, type DB, type Preset, type PresetId } from "@talon/core";
import { dbPath } from "./db";
import { readEnvExample, readEnvFile, secretStatus } from "./envfile";

/** Keys the dashboard may write to the settings table: everything documented in .env.example except secrets/paths/live gate. */
const NEVER_IN_SETTINGS = new Set<string>([...SECRET_KEYS, "LIVE_CONFIRM", "DB_PATH"]);
export const EXTRA_SETTING_KEYS = ["STRATEGY_PRESET", "VOLUME_AVG_N", "MAX_SETUP_BARS", "MAX_CHASE_ATR", "TIME_STOP_BARS", "ATR_N", "ALLOW_LONG", "ALLOW_SHORT", "MIN_NOTIONAL_USD", "MAKER_FEE_BPS", "DEFAULT_HOURLY_FUNDING", "POLL_INTERVAL_MS", "REGIME_ER_N"];
/** Own-property check: "constructor"/"__proto__" are not presets. */
export function isPresetId(x: unknown): x is PresetId {
  return typeof x === "string" && Object.hasOwn(PRESETS, x);
}

export function settableKeys(): Set<string> {
  const s = new Set<string>(EXTRA_SETTING_KEYS);
  for (const e of EDITABLE_SETTINGS) s.add(e.key);
  for (const p of Object.values(PRESETS)) for (const k of Object.keys(p.env)) s.add(k);
  for (const k of NEVER_IN_SETTINGS) s.delete(k);
  return s;
}
export function isSecretKey(k: string): boolean {
  return NEVER_IN_SETTINGS.has(k);
}

/** Type-aware validation of one settings value; returns the normalised string or an error message. */
export function validateSetting(key: string, raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: `${key}: value must be a string` };
  const value = raw.trim();
  if (value.length > 200 || /[\r\n\0]/.test(value)) return { ok: false, error: `${key}: value too long or contains line breaks` };
  const def = EDITABLE_SETTINGS.find((e) => e.key === key);
  const type = def?.type ?? inferType(key);
  if (type === "number") { if (!Number.isFinite(Number(value))) return { ok: false, error: `${key}: must be a number` }; }
  else if (type === "boolean") { if (!["true", "false"].includes(value.toLowerCase())) return { ok: false, error: `${key}: must be true or false` }; return { ok: true, value: value.toLowerCase() }; }
  else if (type === "select") { if (def?.options && !def.options.includes(value)) return { ok: false, error: `${key}: must be one of ${def.options.join("|")}` }; }
  if (key === "STRATEGY_PRESET" && !isPresetId(value)) return { ok: false, error: `STRATEGY_PRESET: unknown preset ${value}` };
  if (key === "HL_ACCOUNT_ADDRESS" && value !== "" && !/^0x[0-9a-fA-F]{40}$/.test(value)) return { ok: false, error: "HL_ACCOUNT_ADDRESS: must be 0x + 40 hex chars" };
  if (key === "UNIVERSE" && !/^[A-Za-z0-9,\s]+$/.test(value)) return { ok: false, error: "UNIVERSE: comma-separated coin symbols" };
  return { ok: true, value };
}
function inferType(key: string): "number" | "boolean" | "text" {
  if (["ALLOW_LONG", "ALLOW_SHORT"].includes(key)) return "boolean";
  if (["STRATEGY_PRESET"].includes(key)) return "text";
  return "number";
}

export type EnvSource = "settings" | "preset" | ".env" | "default" | "override";
export interface EffectiveEntry { key: string; value: string; source: EnvSource; presetValue?: string; secret?: boolean }
export interface EffectiveConfig {
  /** merged, masked map the bot would receive (secrets excluded) */
  values: Record<string, string>;
  entries: EffectiveEntry[];
  preset: Preset | null;
  secrets: Record<string, boolean>;
  mode: "paper" | "live";
  testnet: boolean;
}

export function activePreset(db: DB): Preset | null {
  const id = allSettings(db).STRATEGY_PRESET;
  return isPresetId(id) ? PRESETS[id] : null;
}

/**
 * The configuration the bot would get, with the source of every key. Precedence (low → high): .env.example defaults,
 * repo .env, the active preset, the settings table. Secrets are never included.
 */
export function effectiveConfig(db: DB, presetOverride?: PresetId): EffectiveConfig {
  const defaults = readEnvExample();
  const env = readEnvFile();
  const settings = allSettings(db);
  const preset = presetOverride ? PRESETS[presetOverride] : activePreset(db);
  const keys = new Set<string>([...Object.keys(defaults), ...Object.keys(env), ...Object.keys(settings), ...(preset ? Object.keys(preset.env) : []), "STRATEGY_PRESET"]);
  for (const k of NEVER_IN_SETTINGS) keys.delete(k);
  const entries: EffectiveEntry[] = [];
  const values: Record<string, string> = {};
  for (const key of [...keys].sort()) {
    let value = defaults[key] ?? "", source: EnvSource = "default";
    if (key in env && env[key] !== "") { value = env[key]; source = ".env"; }
    if (preset && key in preset.env) { value = preset.env[key]; source = "preset"; }
    if (key in settings) {
      value = settings[key];
      source = preset && key in preset.env ? (settings[key] === preset.env[key] ? "preset" : "override") : "settings";
    }
    if (key === "STRATEGY_PRESET") { value = preset?.id ?? ""; source = preset ? "settings" : "default"; }
    values[key] = value;
    entries.push({ key, value, source, presetValue: preset?.env[key] });
  }
  const mode = (values.MODE ?? "paper").toLowerCase() === "live" ? "live" : "paper";
  return { values, entries, preset, secrets: secretStatus(), mode, testnet: ["1", "true", "yes", "on"].includes((values.HL_TESTNET ?? "").toLowerCase()) };
}

export interface ComposeOptions {
  mode: "paper" | "live" | "backtest";
  preset?: PresetId;
  /** explicit overrides (re-run of a saved backtest, etc.) applied last */
  extra?: Record<string, string>;
  /** only a confirmed live start sets LIVE_CONFIRM=yes and passes the private key */
  liveConfirmed?: boolean;
}
/** Full environment for a child process: process.env + .env + preset + settings + overrides + {MODE, DB_PATH}. */
export function composeEnv(db: DB, opts: ComposeOptions): NodeJS.ProcessEnv {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") out[k] = v;
  const env = readEnvFile();
  for (const [k, v] of Object.entries(env)) if (v !== "") out[k] = v;
  const settings = allSettings(db);
  const explicit = isPresetId(opts.preset) ? opts.preset : null;
  const active = isPresetId(settings.STRATEGY_PRESET) ? settings.STRATEGY_PRESET : null;
  const presetId = explicit ?? active;
  // implicit (active) preset: preset < settings (user overrides win)
  // explicit preset (run backtest for preset X): settings < preset (the preset must win over the active preset's keys)
  if (!explicit && presetId) Object.assign(out, PRESETS[presetId].env);
  for (const [k, v] of Object.entries(settings)) if (!NEVER_IN_SETTINGS.has(k) && k !== "MODE" && k !== "STRATEGY_PRESET") out[k] = v;
  if (explicit) Object.assign(out, PRESETS[explicit].env);
  if (opts.extra) for (const [k, v] of Object.entries(opts.extra)) if (!NEVER_IN_SETTINGS.has(k) && k !== "MODE" && k !== "DB_PATH") out[k] = v;
  // the live equity cap must never throttle paper trading or backtests
  if (opts.mode !== "live") out.MAX_ACCOUNT_EQUITY = "";
  // explicitly empty (not deleted): the bot's own dotenv loader never overrides a variable that is already set,
  // so a LIVE_CONFIRM/HL_PRIVATE_KEY left in the .env file cannot leak into a paper or job process
  out.LIVE_CONFIRM = "";
  out.HL_PRIVATE_KEY = "";
  out.MODE = opts.mode;
  out.DB_PATH = dbPath();
  out.STRATEGY_PRESET = presetId ?? "";
  if (opts.mode === "live" && opts.liveConfirmed) {
    out.LIVE_CONFIRM = "yes";
    if (env.HL_PRIVATE_KEY) out.HL_PRIVATE_KEY = env.HL_PRIVATE_KEY;
  }
  return out as NodeJS.ProcessEnv;
}

/** Go-live checklist from the effective configuration (no values of secrets). */
export function liveChecklist(db: DB): { keySet: boolean; addressSet: boolean; maxEquitySet: boolean; testnet: boolean; maxEquity: number | null; address: string | null; ready: boolean; problems: string[] } {
  const c = effectiveConfig(db);
  const keySet = !!c.secrets.HL_PRIVATE_KEY;
  const address = c.values.HL_ACCOUNT_ADDRESS?.trim() || null;
  const addressSet = !!address && /^0x[0-9a-fA-F]{40}$/.test(address);
  const maxEquity = Number(c.values.MAX_ACCOUNT_EQUITY);
  const maxEquitySet = Number.isFinite(maxEquity) && maxEquity > 0;
  const problems: string[] = [];
  if (!keySet) problems.push("HL_PRIVATE_KEY is not set (Settings → Secrets)");
  if (!addressSet) problems.push("HL_ACCOUNT_ADDRESS must be the master account address (0x…)");
  if (!maxEquitySet) problems.push("MAX_ACCOUNT_EQUITY must be a positive number");
  return { keySet, addressSet, maxEquitySet, testnet: c.testnet, maxEquity: maxEquitySet ? maxEquity : null, address: addressSet ? address : null, ready: problems.length === 0, problems };
}
