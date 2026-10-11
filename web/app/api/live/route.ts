import { logEvent, setSettings } from "@talon/core";
import { bad, fail, ok, readJson } from "@/lib/api";
import { getDb } from "@/lib/db";
import { liveChecklist } from "@/lib/effective";
import { getSupervisor } from "@/lib/supervisor";

export const dynamic = "force-dynamic";

/** GET → go-live checklist (no secret values). */
export function GET() {
  try {
    const sup = getSupervisor();
    return ok({ checklist: liveChecklist(getDb()), process: sup.process() });
  } catch (e) { return fail(e); }
}

/**
 * POST {action:"confirm", phrase:"LIVE"}  → one-time token (2 min)
 * POST {action:"start", token}            → starts the bot in LIVE mode (LIVE_CONFIRM=yes only for this spawn)
 * POST {action:"back-to-paper"}           → stops a live bot, sets MODE=paper and starts the paper bot
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return bad("body must be {action, ...}");
  const { action } = body;
  try {
    const db = getDb();
    const sup = getSupervisor();
    if (action === "confirm") {
      if (body.phrase !== "LIVE") return bad('type LIVE (capitals) to confirm', 400);
      const check = liveChecklist(db);
      if (!check.ready) return bad(`not ready for live: ${check.problems.join("; ")}`, 409);
      const proc = sup.process();
      if (proc.status === "running") return bad(`bot process is already running in ${proc.mode} mode — stop it first`, 409);
      const t = sup.mintToken();
      logEvent(db, "live", "warn", "dashboard: live start confirmed (token issued, valid 2 min)");
      return ok({ token: t.token, expiresAt: t.expiresAt, checklist: check });
    }
    if (action === "start") {
      if (typeof body.token !== "string" || !body.token) return bad("token required (confirm first)", 403);
      const proc = await sup.start({ mode: "live", token: body.token });
      setSettings(db, { MODE: "live" });
      return ok({ process: proc });
    }
    if (action === "back-to-paper") {
      const proc = sup.process();
      let stopped = false;
      if (proc.status === "running" && proc.mode === "live") { await sup.stop(); stopped = true; }
      setSettings(db, { MODE: "paper" });
      logEvent(db, "live", "info", `dashboard: back to paper${stopped ? " (live bot stopped; positions and exchange stops untouched)" : ""}`);
      const started = sup.process().status === "running" ? sup.process() : await sup.start({ mode: "paper" });
      return ok({ stopped, process: started });
    }
    return bad("action must be confirm|start|back-to-paper");
  } catch (e) { return fail(e); }
}
