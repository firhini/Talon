"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import type { DashboardState } from "@/lib/state";
import LiveDialog, { ConfirmDialog } from "./LiveDialog";

type Cmd = "start" | "pause" | "kill" | "reset";

/** Process buttons (supervisor) + trading commands (bot control queue) + go-live. */
export default function Controls({ s, onChanged }: { s: DashboardState; onChanged?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmKill, setConfirmKill] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const mode = s.mode, p = s.process, bot = s.bot;
  const procRunning = p.status === "running" || p.status === "stopping";
  const viewingRunningMode = procRunning && p.mode === mode;

  function say(ok: boolean, text: string) { setToast({ ok, text }); setTimeout(() => setToast(null), 5000); }
  async function run(key: string, f: () => Promise<string>) {
    setBusy(key);
    try { say(true, await f()); } catch (e) { say(false, (e as Error).message); } finally { setBusy(null); setConfirmKill(false); onChanged?.(); }
  }
  const cmd = (c: Cmd) => run(c, async () => { const r = await api<{ alreadyQueued?: boolean }>("/api/control", { mode, cmd: c }); return r.alreadyQueued ? `"${c}" already queued` : `Queued "${c}" for the ${mode} bot (picked up on its next tick)`; });
  const proc = (action: "start" | "stop" | "restart") => run(action, async () => { await api("/api/process", { action, mode: action === "start" ? "paper" : undefined }); return action === "stop" ? "Bot process stopped — open position and exchange stops are untouched" : `Bot process ${action}ed (paper)`; });
  const backToPaper = () => run("paper", async () => { await api("/api/live", { action: "back-to-paper" }); return "Back to paper: live bot stopped, paper bot started"; });

  const locked = busy !== null;
  const tradingLocked = locked || s.pendingCmd !== null || !viewingRunningMode;
  return (
    <div className="panel flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2">
      <Group label="Bot process">
        {!procRunning && mode === "paper" && <button className="btn btn-good" disabled={locked || !p.built} onClick={() => proc("start")} title={p.built ? "Spawn bot/dist/main.js in paper mode" : "bot not built — run the launcher"}>▶ Start paper bot</button>}
        {!procRunning && mode === "live" && <button className="btn btn-live" disabled={locked} onClick={() => setLiveOpen(true)}>▶ Go live…</button>}
        {procRunning && <button className="btn btn-bad" disabled={locked} onClick={() => proc("stop")} title="SIGTERM; the bot persists state and exits. Positions and exchange stops stay.">■ Stop process</button>}
        {procRunning && p.mode === "paper" && <button className="btn btn-default" disabled={locked} onClick={() => proc("restart")} title="Stop and start again with the current settings">↻ Restart</button>}
        {procRunning && p.mode === "live" && <button className="btn btn-warn" disabled={locked} onClick={backToPaper} title="Stop the live bot, set MODE=paper and start the paper bot">← Back to paper</button>}
        {!procRunning && mode === "paper" && <button className="btn btn-ghost" disabled={locked} onClick={() => setLiveOpen(true)} title="Start the bot with real money (typed confirmation)">Go live…</button>}
        {procRunning && p.mode !== mode && <span className="text-xs text-amber-300">process is running in <b>{p.mode}</b> mode — <a className="underline" href={`/?mode=${p.mode}`}>view it</a></span>}
      </Group>
      <span className="hidden h-6 w-px bg-zinc-800 sm:block" />
      <Group label="Trading">
        <button className="btn btn-good" disabled={tradingLocked} onClick={() => cmd("start")} title="Allow new entries">Start</button>
        <button className="btn btn-warn" disabled={tradingLocked} onClick={() => cmd("pause")} title="No new entries; the open position is still managed">Pause</button>
        <button className="btn btn-bad" disabled={tradingLocked} onClick={() => setConfirmKill(true)} title="Flatten everything, cancel all orders, halt">Kill-switch</button>
        <button className={`btn btn-default ${bot?.halted ? "ring-1 ring-amber-400" : ""}`} disabled={tradingLocked} onClick={() => cmd("reset")} title="Clear the halt flag; baselines reset; bot stays paused until Start">Reset halt</button>
        {!viewingRunningMode && <span className="text-[11px] text-zinc-500">{procRunning ? "" : "start the bot process first"}</span>}
      </Group>
      <div className="ml-auto flex items-center gap-2 text-xs">
        {s.pendingCmd && <span role="status" className="chip border-sky-600/50 text-sky-300" title="The bot polls for commands every ~15 s">queued &quot;{s.pendingCmd}&quot;</span>}
        {toast && <span role="status" className={`rounded-md border px-2.5 py-1 ${toast.ok ? "border-emerald-600/50 text-emerald-300" : "border-rose-600/50 text-rose-300"}`}>{toast.text}</span>}
      </div>
      <ConfirmDialog open={confirmKill} title="Kill switch" danger confirmLabel="Yes, flatten and halt" busy={busy === "kill"} onClose={() => setConfirmKill(false)} onConfirm={() => cmd("kill")}
        body={<p>Closes the open position at market, cancels every order and halts the {mode} bot until you press <b>Reset halt</b>.</p>} />
      <LiveDialog open={liveOpen} onClose={() => setLiveOpen(false)} onStarted={() => { say(true, "LIVE bot started"); onChanged?.(); if (mode !== "live") window.location.href = "/?mode=live"; }} />
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="label mr-1">{label}</span>
      {children}
    </div>
  );
}
