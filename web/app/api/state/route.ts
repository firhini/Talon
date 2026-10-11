import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildState, resolveMode } from "@/lib/state";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  try {
    const db = getDb();
    const mode = resolveMode(db, new URL(req.url).searchParams.get("mode"));
    return NextResponse.json(buildState(db, mode), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
