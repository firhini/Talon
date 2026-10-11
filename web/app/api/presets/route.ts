import { isPresetId } from "@/lib/effective";
import { allSettings, EDITABLE_SETTINGS, logEvent, PRESET_LIST, PRESETS, setSettings, type PresetId } from "@talon/core";
import { bad, fail, ok, readJson, guardOrigin } from "@/lib/api";
import { getDb } from "@/lib/db";
import { OVERRIDABLE_GROUPS, presetsPayload } from "@/lib/payloads";
import { getSupervisor } from "@/lib/supervisor";

export const dynamic = "force-dynamic";

export function GET() {
  try { return ok(presetsPayload()); } catch (e) { return fail(e); }
}

/** POST {action: activate|reset-overrides|run-backtest|run-all, id?} */
export async function POST(req: Request) {
  const cors = guardOrigin(req); if (cors) return cors;
  const body = await readJson(req);
  if (!body) return bad("body must be {action, id?}");
  const { action, id } = body;
  const needsId = action === "activate" || action === "run-backtest";
  if (needsId && !isPresetId(id)) return bad(`id must be one of ${Object.keys(PRESETS).join("|")}`);
  try {
    const db = getDb();
    const sup = getSupervisor();
    if (action === "activate") {
      const r = await sup.activatePreset(id as PresetId);
      const p = PRESETS[id as PresetId];
      logEvent(db, sup.process().mode ?? "paper", p.riskLevel >= 4 ? "warn" : "info", `dashboard: preset "${p.name}" activated (risk ${p.riskLevel}/5)${r.restarted ? ", bot restarted" : r.stopped ? ", LIVE bot stopped — go live again to apply" : ""}`);
      return ok({ ...r, ...presetsPayload() });
    }
    if (action === "reset-overrides") {
      const settings = allSettings(db);
      const active = isPresetId(settings.STRATEGY_PRESET) ? PRESETS[settings.STRATEGY_PRESET] : null;
      if (!active) return bad("no active preset", 409);
      const patch: Record<string, string | null> = {};
      for (const e of EDITABLE_SETTINGS) if (OVERRIDABLE_GROUPS.has(e.group) && e.key in settings) patch[e.key] = null;
      Object.assign(patch, active.env);
      setSettings(db, patch);
      return ok({ ...presetsPayload(), restartNeeded: sup.process().status === "running" });
    }
    if (action === "run-backtest") {
      const p = PRESETS[id as PresetId];
      const jobId = sup.createJob("backtest", { preset: p.id, label: p.backtestLabel, kill: "halt" });
      return ok({ jobId }, 201);
    }
    if (action === "run-all") {
      const jobIds = PRESET_LIST.map((p) => sup.createJob("backtest", { preset: p.id, label: p.backtestLabel, kill: "halt" }));
      return ok({ jobIds }, 201);
    }
    return bad("action must be activate|reset-overrides|run-backtest|run-all");
  } catch (e) { return fail(e); }
}
