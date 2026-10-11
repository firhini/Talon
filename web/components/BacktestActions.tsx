"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { ConfirmDialog } from "./LiveDialog";

export function BacktestListActions({ count }: { count: number }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runAll = async () => {
    setBusy(true);
    try { const r = await api<{ jobIds: number[] }>("/api/presets", { action: "run-all" }); setMsg(`queued ${r.jobIds.length} jobs (#${r.jobIds.join(", #")}) — see System`); }
    catch (e) { setMsg(`error: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  return (
    <span className="flex items-center gap-2">
      <span>{count} saved</span>
      {msg && <span className="text-zinc-300">{msg}</span>}
      <button className="btn btn-default btn-sm" disabled={busy} onClick={() => void runAll()}>Run all preset backtests</button>
    </span>
  );
}

export function BacktestDetailActions({ id, mode }: { id: number; mode: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const rerun = async () => {
    setBusy("rerun");
    try { const r = await api<{ jobId: number }>(`/api/backtests/${id}`, { action: "rerun" }); setMsg(`re-run queued as job #${r.jobId} — a new report appears in the list when it finishes`); }
    catch (e) { setMsg(`error: ${(e as Error).message}`); } finally { setBusy(null); }
  };
  const del = async () => {
    setBusy("delete");
    try { await api(`/api/backtests/${id}`, undefined, "DELETE"); router.push(`/backtests?mode=${mode}`); router.refresh(); }
    catch (e) { setMsg(`error: ${(e as Error).message}`); setBusy(null); setConfirm(false); }
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      {msg && <span className="text-xs text-zinc-300">{msg}</span>}
      <button className="btn btn-default btn-sm" disabled={busy !== null} onClick={() => void rerun()}>↻ Re-run</button>
      <button className="btn btn-bad btn-sm" disabled={busy !== null} onClick={() => setConfirm(true)}>Delete</button>
      <ConfirmDialog open={confirm} danger title={`Delete backtest #${id}?`} body={<p>The saved report, equity curve and trades are removed. This cannot be undone.</p>} confirmLabel="Delete" busy={busy === "delete"} onClose={() => setConfirm(false)} onConfirm={() => void del()} />
    </span>
  );
}
