import { NextResponse } from "next/server";
import { enqueueCommand, getControl, logEvent, type ControlCommand } from "@talon/core";
import { getDb } from "@/lib/db";
import { isDashMode } from "@/lib/mode";

export const dynamic = "force-dynamic";

const CMDS: readonly ControlCommand[] = ["start", "pause", "kill", "reset"];

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "body must be JSON {mode, cmd}" }, { status: 400 }); }
  const { mode, cmd } = (body ?? {}) as { mode?: unknown; cmd?: unknown };
  if (!isDashMode(mode)) return NextResponse.json({ ok: false, error: "mode must be paper|live" }, { status: 400 });
  if (typeof cmd !== "string" || !CMDS.includes(cmd as ControlCommand)) return NextResponse.json({ ok: false, error: `cmd must be one of ${CMDS.join("|")}` }, { status: 400 });
  try {
    const db = getDb();
    // The bot's command queue is a single slot per mode (control row `cmd:<mode>`, drained once per tick, ~15 s).
    // Never overwrite a command the bot has not consumed yet: "reset" followed by "start" would otherwise silently
    // drop the reset and the still-halted engine would ignore the start.
    const pending = getControl(db, `cmd:${mode}`);
    if (pending && pending !== cmd) {
      return NextResponse.json(
        { ok: false, pending, error: `'${pending}' is still waiting for the bot (it polls every ~15 s) — retry in a moment` },
        { status: 409 },
      );
    }
    if (pending === cmd) return NextResponse.json({ ok: true, mode, cmd, alreadyQueued: true }); // idempotent re-press, no duplicate event
    enqueueCommand(db, mode, cmd as ControlCommand);
    logEvent(db, mode, cmd === "kill" ? "warn" : "info", `dashboard: ${cmd} requested`);
    return NextResponse.json({ ok: true, mode, cmd });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
