import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { allSettings, EDITABLE_SETTINGS, PRESET_LIST, PRESETS, REPO_ROOT, type PresetId } from "@talon/core";
import { asMetrics, summarize } from "./backtest";
import { dataCoverage, dbPath, dbSizeBytes, getDb, latestBacktestByLabel, tableCounts } from "./db";
import { effectiveConfig } from "./effective";
import { envFilePath } from "./envfile";
import { getSupervisor } from "./supervisor";

/** Payload builders shared by the API routes and the server-rendered pages (same JSON on first paint and on poll). */

export function settingsPayload() {
  const db = getDb();
  const cfg = effectiveConfig(db);
  const proc = getSupervisor().process();
  return {
    settings: allSettings(db), effective: cfg.entries, values: cfg.values, editable: EDITABLE_SETTINGS,
    preset: cfg.preset ? { id: cfg.preset.id, name: cfg.preset.name, riskLevel: cfg.preset.riskLevel, env: cfg.preset.env } : null,
    secrets: cfg.secrets, mode: cfg.mode, testnet: cfg.testnet, botRunning: proc.status === "running", botMode: proc.mode, envFile: envFilePath(),
  };
}
export type SettingsPayload = ReturnType<typeof settingsPayload>;

export const OVERRIDABLE_GROUPS = new Set(["Strategy", "Risk", "Market"]);

export function presetsPayload() {
  const db = getDb();
  const settings = allSettings(db);
  const active = settings.STRATEGY_PRESET in PRESETS ? (settings.STRATEGY_PRESET as PresetId) : null;
  const keys = EDITABLE_SETTINGS.filter((e) => OVERRIDABLE_GROUPS.has(e.group)).map((e) => e.key);
  const presets = PRESET_LIST.map((p) => {
    const bt = latestBacktestByLabel(db, p.backtestLabel);
    const m = bt ? asMetrics(bt.metrics) : null;
    const overrides: Record<string, string> = {};
    if (active === p.id) for (const k of keys) if (k in settings && settings[k] !== p.env[k]) overrides[k] = settings[k];
    return { ...p, active: active === p.id, backtest: bt ? summarize(bt) : null, mc: m?.mc ?? null, metrics: m, overrides };
  });
  const proc = getSupervisor().process();
  return { presets, active, botRunning: proc.status === "running", botMode: proc.mode };
}
export type PresetsPayload = ReturnType<typeof presetsPayload>;
export type PresetCardData = PresetsPayload["presets"][number];

function version(pkg: string): string {
  try { return (JSON.parse(readFileSync(resolve(REPO_ROOT, "node_modules", pkg, "package.json"), "utf8")) as { version: string }).version; } catch { return "?"; }
}

export function systemPayload(lines = 200) {
  const db = getDb();
  const sup = getSupervisor();
  const talon = (() => { try { return (JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8")) as { version: string }).version; } catch { return "?"; } })();
  return {
    now: Date.now(),
    process: sup.process(),
    log: sup.logTail(lines),
    jobs: sup.jobs(50),
    currentJob: sup.current(),
    coverage: dataCoverage(db),
    counts: tableCounts(db),
    db: { path: dbPath(), sizeBytes: dbSizeBytes() },
    envFile: envFilePath(),
    build: { core: existsSync(resolve(REPO_ROOT, "core", "dist", "index.js")), bot: existsSync(resolve(REPO_ROOT, "bot", "dist", "main.js")), web: existsSync(resolve(REPO_ROOT, "web", ".next", "BUILD_ID")) },
    versions: { talon, node: process.version, next: version("next"), react: version("react"), sqlite: version("better-sqlite3"), platform: `${process.platform} ${process.arch}` },
    webStartedAt: sup.startedAt,
    repoRoot: REPO_ROOT,
  };
}
export type SystemPayload = ReturnType<typeof systemPayload>;
