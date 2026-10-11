import { bad, fail, idFrom, intParam, ok, readJson, guardOrigin } from "@/lib/api";
import { getSupervisor } from "@/lib/supervisor";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const id = idFrom((await params).id);
  if (id === null) return bad("bad job id");
  try {
    const tail = intParam(new URL(req.url).searchParams.get("tail"), 0, 0, 5000);
    const job = getSupervisor().job(id, tail);
    return job ? ok({ job }) : bad("job not found", 404);
  } catch (e) { return fail(e); }
}

/** POST {action:"cancel"} (DELETE does the same) */
export async function POST(req: Request, ctx: Ctx) {
  const cors = guardOrigin(req); if (cors) return cors;
  const body = await readJson(req);
  if (!body || body.action !== "cancel") return bad("action must be cancel");
  return DELETE(req, ctx);
}
export async function DELETE(req: Request, { params }: Ctx) {
  const cors = guardOrigin(req); if (cors) return cors;
  const id = idFrom((await params).id);
  if (id === null) return bad("bad job id");
  try {
    const job = getSupervisor().cancel(id);
    return job ? ok({ job }) : bad("job not found", 404);
  } catch (e) { return fail(e); }
}
