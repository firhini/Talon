import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseMode } from "@/lib/mode";
import { buildState } from "@/lib/state";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  try {
    const mode = parseMode(new URL(req.url).searchParams.get("mode"));
    return NextResponse.json(buildState(getDb(), mode), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
