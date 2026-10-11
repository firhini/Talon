"use client";

/** Browser-side fetch helper: JSON in/out, throws the server's error message. */
export async function api<T = Record<string, unknown>>(url: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const res = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok || data.ok === false) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

/** Poll a JSON endpoint every `ms` while the tab is visible; `setter` receives each payload. Returns the cleanup. */
export function poll<T>(url: () => string, ms: number, setter: (d: T) => void, onError?: (e: Error) => void): () => void {
  let stop = false, inflight = false;
  const tick = async () => {
    if (stop || inflight || document.hidden) return;
    inflight = true;
    try { const r = await fetch(url(), { cache: "no-store" }); if (!r.ok) throw new Error(`HTTP ${r.status}`); const d = (await r.json()) as T; if (!stop) setter(d); onError?.(null as unknown as Error); }
    catch (e) { onError?.(e as Error); }
    finally { inflight = false; }
  };
  const id = setInterval(tick, ms);
  const onVis = () => { if (!document.hidden) void tick(); };
  document.addEventListener("visibilitychange", onVis);
  return () => { stop = true; clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
}
