import { logEvent, SECRET_KEYS } from "@talon/core";
import { bad, fail, ok, readJson, guardOrigin } from "@/lib/api";
import { getDb } from "@/lib/db";
import { envFilePath, isPrivateKey, secretStatus, writeEnvKey } from "@/lib/envfile";
import { getSupervisor } from "@/lib/supervisor";

export const dynamic = "force-dynamic";

/** GET → {secrets: {HL_PRIVATE_KEY: true|false}} — values are never returned. */
export function GET() {
  try { return ok({ secrets: secretStatus(), envFile: envFilePath() }); } catch (e) { return fail(e); }
}

/** POST {key: "HL_PRIVATE_KEY", value: "0x…" | null} — written only to the .env file. */
export async function POST(req: Request) {
  const cors = guardOrigin(req); if (cors) return cors;
  const body = await readJson(req);
  if (!body) return bad("body must be {key, value}");
  const { key, value } = body;
  if (typeof key !== "string" || !SECRET_KEYS.includes(key)) return bad(`key must be one of ${SECRET_KEYS.join("|")}`);
  if (value !== null && value !== "" && key === "HL_PRIVATE_KEY" && !isPrivateKey(value)) return bad("HL_PRIVATE_KEY must be 0x + 64 hex characters (the API wallet key)");
  try {
    writeEnvKey(key, value === null || value === "" ? null : (value as string));
    const status = secretStatus();
    const proc = getSupervisor().process();
    logEvent(getDb(), proc.mode ?? "paper", "info", `dashboard: ${key} ${status[key] ? "updated" : "removed"} in .env`);
    return ok({ secrets: status, restartNeeded: proc.status === "running" && proc.mode === "live" });
  } catch (e) { return fail(e); }
}
