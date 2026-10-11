import { logEvent, setSettings } from "@talon/core";
import { bad, fail, ok, readJson, guardOrigin } from "@/lib/api";
import { getDb } from "@/lib/db";
import { isSecretKey, settableKeys, validateSetting } from "@/lib/effective";
import { settingsPayload } from "@/lib/payloads";
import { getSupervisor } from "@/lib/supervisor";

export const dynamic = "force-dynamic";

export function GET() {
  try { return ok(settingsPayload()); } catch (e) { return fail(e); }
}

/** PUT {values: {KEY: "value" | null}} — null/"" removes the override. Secrets are refused here (see /api/secrets). */
export async function PUT(req: Request) {
  const cors = guardOrigin(req); if (cors) return cors;
  const body = await readJson(req);
  if (!body || !body.values || typeof body.values !== "object" || Array.isArray(body.values)) return bad("body must be {values: {KEY: value}}");
  const values = body.values as Record<string, unknown>;
  const keys = Object.keys(values);
  if (!keys.length) return bad("no values");
  if (keys.length > 200) return bad("too many keys");
  const allowed = settableKeys();
  const patch: Record<string, string | null> = {};
  for (const k of keys) {
    if (isSecretKey(k)) return bad(`${k} is a secret and is never stored in the database`);
    if (!allowed.has(k)) return bad(`unknown setting ${k}`);
    const v = values[k];
    if (v === null || v === "") { patch[k] = null; continue; }
    const r = validateSetting(k, typeof v === "number" || typeof v === "boolean" ? String(v) : v);
    if (!r.ok) return bad(r.error);
    patch[k] = r.value;
  }
  try {
    const db = getDb();
    setSettings(db, patch);
    const proc = getSupervisor().process();
    if (proc.mode) logEvent(db, proc.mode, "info", `dashboard: settings changed (${keys.join(", ")})${proc.status === "running" ? " — restart the bot to apply" : ""}`);
    return ok({ ...settingsPayload(), restartNeeded: proc.status === "running", changed: keys });
  } catch (e) { return fail(e); }
}

export const POST = PUT;
