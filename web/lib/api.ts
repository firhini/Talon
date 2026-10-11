import { NextResponse } from "next/server";
import type { SupervisorError } from "./supervisor";

/** Tiny helpers so every route answers the same way: {ok:true,...} or {ok:false,error}. Never cached. */
const NO_STORE = { "cache-control": "no-store" };

export function ok(data: Record<string, unknown> = {}, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...data }, { status, headers: NO_STORE });
}
export function bad(error: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}
export function fail(e: unknown): NextResponse {
  // duck-typed: the supervisor singleton lives on globalThis, so its class identity differs between route bundles
  const se = e as Partial<SupervisorError> | null;
  if (se && se.name === "SupervisorError" && typeof se.status === "number") return bad(se.message ?? "error", se.status);
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
  if (v === null || v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n)) return def;
  return Math.min(max, Math.max(min, n));
}
/**
 * Mutating routes accept only same-origin requests: a page on another site must not be able to kill the bot,
 * rewrite settings or overwrite the key through the user's browser. Non-browser clients (curl) send neither header.
 */
export function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  if (origin) {
    try { return new URL(origin).host === req.headers.get("host"); } catch { return false; }
  }
  return true;
}
export function guardOrigin(req: Request): NextResponse | null {
  return sameOrigin(req) ? null : bad("cross-origin request refused", 403);
}
export function idFrom(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
