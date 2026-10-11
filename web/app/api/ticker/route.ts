import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { effectiveConfig } from "@/lib/effective";
import { getTicker } from "@/lib/ticker";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cfg = effectiveConfig(getDb());
    const coins = (cfg.values.UNIVERSE ?? "BTC,ETH,SOL,BNB,HYPE").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 20);
    const t = await getTicker(coins);
    return NextResponse.json(t, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ t: Date.now(), stale: true, error: (e as Error).message, rows: [] }, { status: 200, headers: { "cache-control": "no-store" } });
  }
}
