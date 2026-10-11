import { bad, fail, intParam, ok, readJson } from "@/lib/api";
import { getSupervisor } from "@/lib/supervisor";

export const dynamic = "force-dynamic";

/** GET → bot process state + log tail. POST {action: start|stop|restart, mode?, token?} */
export function GET(req: Request) {
  try {
    const sup = getSupervisor();
    const lines = intParam(new URL(req.url).searchParams.get("lines"), 200, 0, 2000);
    return ok({ process: sup.process(), log: lines ? sup.logTail(lines) : undefined });
  } catch (e) { return fail(e); }
}

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return bad("body must be a JSON object {action, mode?, token?}");
  const { action, mode, token } = body;
  if (action !== "start" && action !== "stop" && action !== "restart") return bad("action must be start|stop|restart");
  if (mode !== undefined && mode !== "paper" && mode !== "live") return bad("mode must be paper|live");
  if (token !== undefined && (typeof token !== "string" || token.length > 128)) return bad("token must be a string");
  try {
    const sup = getSupervisor();
    if (action === "stop") return ok({ process: await sup.stop() });
    if (action === "restart") return ok({ process: await sup.restart({ token: token as string | undefined }) });
    // paper is the default; a live start is only reachable with a confirmation token from /api/live
    return ok({ process: await sup.start({ mode: (mode as "paper" | "live" | undefined) ?? "paper", token: token as string | undefined }) });
  } catch (e) { return fail(e); }
}
