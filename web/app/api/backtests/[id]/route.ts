import { getBacktest, type Trade } from "@talon/core";
import { bad, fail, idFrom, ok, readJson, guardOrigin } from "@/lib/api";
import { asMetrics, asParams, paramsToEnv, summarize } from "@/lib/backtest";
import { deleteBacktest, getDb } from "@/lib/db";
import { tradeStats } from "@/lib/stats";
import { getSupervisor } from "@/lib/supervisor";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const id = idFrom((await params).id);
  if (id === null) return bad("bad backtest id");
  try {
    const bt = getBacktest(getDb(), id);
    if (!bt) return bad("backtest not found", 404);
    const trades = (Array.isArray(bt.trades) ? bt.trades : []) as Trade[];
    return ok({ backtest: { ...summarize(bt), params: bt.params, metrics: asMetrics(bt.metrics), equityCurve: bt.equityCurve, trades, stats: tradeStats(trades, Number(asMetrics(bt.metrics)?.to ?? Date.now())) } });
  } catch (e) { return fail(e); }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const cors = guardOrigin(req); if (cors) return cors;
  const id = idFrom((await params).id);
  if (id === null) return bad("bad backtest id");
  try { return deleteBacktest(getDb(), id) ? ok({ deleted: id }) : bad("backtest not found", 404); } catch (e) { return fail(e); }
}

/** POST {action:"rerun"} → queues a backtest job with the stored parameters as env. */
export async function POST(req: Request, { params }: Ctx) {
  const cors = guardOrigin(req); if (cors) return cors;
  const id = idFrom((await params).id);
  if (id === null) return bad("bad backtest id");
  const body = await readJson(req);
  if (!body || body.action !== "rerun") return bad("action must be rerun");
  try {
    const bt = getBacktest(getDb(), id);
    if (!bt) return bad("backtest not found", 404);
    const env = paramsToEnv(asParams(bt.params));
    const label = bt.label.replace(/ \(re-run.*\)$/, "");
    const jobId = getSupervisor().createJob("backtest", { label, env, kill: "halt" });
    return ok({ jobId }, 201);
  } catch (e) { return fail(e); }
}
