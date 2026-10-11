import { bad, fail, intParam, ok, readJson, guardOrigin } from "@/lib/api";
import { getSupervisor, validateJob } from "@/lib/supervisor";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  try {
    const sup = getSupervisor();
    const limit = intParam(new URL(req.url).searchParams.get("limit"), 50, 1, 200);
    return ok({ jobs: sup.jobs(limit), current: sup.current() });
  } catch (e) { return fail(e); }
}

/** POST {kind: fetch|backtest|sweep|scan, args: {...}} → {id} */
export async function POST(req: Request) {
  const cors = guardOrigin(req); if (cors) return cors;
  const body = await readJson(req);
  if (!body) return bad("body must be a JSON object {kind, args}");
  const v = validateJob(body.kind, body.args);
  if ("error" in v) return bad(v.error);
  try {
    const sup = getSupervisor();
    const id = sup.createJob(v.kind, v.args);
    return ok({ id, job: sup.job(id) }, 201);
  } catch (e) { return fail(e); }
}
