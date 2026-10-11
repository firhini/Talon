import { fail, intParam, ok } from "@/lib/api";
import { systemPayload } from "@/lib/payloads";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  try {
    const lines = intParam(new URL(req.url).searchParams.get("lines"), 200, 0, 2000);
    return ok(systemPayload(lines));
  } catch (e) { return fail(e); }
}
