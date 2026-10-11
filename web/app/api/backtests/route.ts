import { listBacktests } from "@talon/core";
import { fail, intParam, ok } from "@/lib/api";
import { summarize } from "@/lib/backtest";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  try {
    const limit = intParam(new URL(req.url).searchParams.get("limit"), 100, 1, 500);
    return ok({ backtests: listBacktests(getDb(), limit).map(summarize) });
  } catch (e) { return fail(e); }
}
