"use client";
import { useState } from "react";
import type { DashMode } from "@/lib/mode";

type Cmd = "start" | "pause" | "kill" | "reset";

export default function Controls({ mode, halted, onSent }: { mode: DashMode; halted: boolean; onSent?: () => void }) {
  const [busy, setBusy] = useState<Cmd | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmKill, setConfirmKill] = useState(false);

  async function send(cmd: Cmd) {
    setBusy(cmd);
    try {
      const res = await fetch("/api/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, cmd }) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && body.ok) setToast({ ok: true, text: `Queued "${cmd}" for ${mode} bot` });
      else setToast({ ok: false, text: body.error ?? `HTTP ${res.status}` });
      onSent?.();
    } catch (e) {
      setToast({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
      setConfirmKill(false);
      setTimeout(() => setToast(null), 4000);
    }
  }

  const btn = "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className={`${btn} border-emerald-600/60 bg-emerald-600/15 text-emerald-300 hover:bg-emerald-600/25`} disabled={busy !== null} onClick={() => send("start")}>Start</button>
      <button className={`${btn} border-amber-500/60 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25`} disabled={busy !== null} onClick={() => send("pause")}>Pause</button>
      {confirmKill ? (
        <span className="flex items-center gap-2 rounded-md border border-red-600 bg-red-950/60 px-2 py-1 text-sm">
          <span className="text-red-200">Flatten position and halt?</span>
          <button className="rounded bg-red-600 px-2 py-0.5 font-semibold text-white hover:bg-red-500" disabled={busy !== null} onClick={() => send("kill")}>Yes, kill</button>
          <button className="rounded px-2 py-0.5 text-zinc-300 hover:text-white" onClick={() => setConfirmKill(false)}>Cancel</button>
        </span>
      ) : (
        <button className={`${btn} border-red-600 bg-red-600/20 text-red-300 hover:bg-red-600/40`} disabled={busy !== null} onClick={() => setConfirmKill(true)}>Kill-switch</button>
      )}
      <button className={`${btn} border-zinc-600 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 ${halted ? "ring-1 ring-amber-400" : ""}`} disabled={busy !== null} onClick={() => send("reset")} title="Clear the halt flag so the bot may trade again">Reset halt</button>
      {toast && (
        <span role="status" className={`rounded-md border px-2.5 py-1 text-xs ${toast.ok ? "border-emerald-600/50 text-emerald-300" : "border-rose-600/50 text-rose-300"}`}>{toast.text}</span>
      )}
    </div>
  );
}
