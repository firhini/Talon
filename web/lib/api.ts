import { NextResponse } from "next/server";
import { SupervisorError } from "./supervisor";

/** Tiny helpers so every route answers the same way: {ok:true,...} or {ok:false,error}. Never cached. */
const NO_STORE = { "cache-control": "no-store" };

export function ok(data: Record<string, unknown> = {}, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...data }, { status, headers: NO_STORE });
}
export function bad(error: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}
export function fail(e: unknown): NextResponse {
  if (e instanceof SupervisorError) return bad(e.message, e.status);
  return bad((e as Error).message ?? "internal error", 500);
}
/** Body must be a JSON object; anything else → null (caller answers 400). */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b: unknown = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch { return null; }
}
export function intParam(v: string | null | undefined, def: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isInteger(n)) return def;
  return Math.min(max, Math.max(min, n));
}
export function idFrom(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
