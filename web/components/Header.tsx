import Link from "next/link";
import type { DashMode } from "@/lib/mode";
import type { ProcessView } from "@/lib/supervisor";
import { fmtUptime } from "@/lib/format";

export function ModeBadge({ mode, testnet, big = true }: { mode: DashMode; testnet?: boolean; big?: boolean }) {
  const size = big ? "px-3 py-1 text-base tracking-[0.2em]" : "px-2 py-0.5 text-xs tracking-widest";
  if (mode === "live" && testnet) {
    return <span className={`rounded-md border-2 border-red-500 font-bold text-red-400 ${size}`}>LIVE · TESTNET</span>;
  }
  if (mode === "live") {
    return <span className={`pulse-live rounded-md bg-red-600 font-bold text-white ${size}`}>LIVE</span>;
  }
  return <span className={`rounded-md bg-amber-500 font-bold text-black ${size}`}>PAPER</span>;
}

export function StatusPill({ status, offline, halted, reason }: { status: string | null; offline: boolean; halted: boolean; reason?: string | null }) {
  if (offline) return <span className="chip border-zinc-700 bg-zinc-800 text-zinc-300">OFFLINE</span>;
  const s = halted ? "halted" : status ?? "unknown";
  const cls: Record<string, string> = {
    running: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
    paused: "bg-amber-500/15 text-amber-300 border-amber-500/40",
    halted: "bg-rose-500/15 text-rose-300 border-rose-500/40",
    stopped: "bg-zinc-500/15 text-zinc-300 border-zinc-500/40",
  };
  return (
    <span className={`chip ${cls[s] ?? cls.stopped}`} title={reason ?? undefined}>
      {s === "running" && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}
      {s.toUpperCase()}
    </span>
  );
}

/** Bot *process* state (the supervisor's child), distinct from the trading status above. */
export function ProcessChip({ p, lastTickAgoMs }: { p: ProcessView; lastTickAgoMs?: number | null }) {
  if (p.status === "running") {
    const stale = lastTickAgoMs !== null && lastTickAgoMs !== undefined && lastTickAgoMs > 90_000;
    return (
      <span className={`chip ${stale ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-sky-500/40 bg-sky-500/10 text-sky-300"}`} title={`pid ${p.pid}${p.external ? " (started by a previous web server)" : ""}`}>
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${stale ? "bg-amber-400" : "bg-sky-400"}`} />
        PROCESS {stale ? "STALE" : "UP"} <span className="num font-normal text-zinc-400">pid {p.pid} · {fmtUptime(p.uptimeMs)}</span>
      </span>
    );
  }
  if (p.status === "stopping") return <span className="chip border-amber-500/40 bg-amber-500/10 text-amber-300 blink">STOPPING…</span>;
  if (p.status === "crashed") return <span className="chip border-rose-500/50 bg-rose-500/10 text-rose-300" title={p.lastExit ? `exit code ${p.lastExit.code ?? "?"} ${p.lastExit.signal ?? ""}` : undefined}>PROCESS CRASHED</span>;
  return <span className="chip border-zinc-700 bg-zinc-800/60 text-zinc-400">PROCESS STOPPED</span>;
}

/** Shown when a bot in the *other* mode has a fresh heartbeat, so a live bot is never trading unseen behind a PAPER view. */
export function OtherModeChip({ mode }: { mode: DashMode }) {
  const other: DashMode = mode === "paper" ? "live" : "paper";
  const cls = other === "live" ? "pulse-live bg-red-600 text-white" : "bg-amber-500 text-black";
  return (
    <Link href={`/?mode=${other}`} className={`rounded-md px-2 py-0.5 text-xs font-bold tracking-wider ${cls}`} title={`A bot is running in ${other} mode — click to view it`}>
      {other.toUpperCase()} BOT RUNNING
    </Link>
  );
}

export type NavKey = "dashboard" | "strategies" | "backtests" | "settings" | "system";
const NAV: { key: NavKey; href: string; label: string }[] = [
  { key: "dashboard", href: "/", label: "Command center" },
  { key: "strategies", href: "/strategies", label: "Strategy lab" },
  { key: "backtests", href: "/backtests", label: "Backtests" },
  { key: "settings", href: "/settings", label: "Settings" },
  { key: "system", href: "/system", label: "System" },
];

export function Nav({ mode, active }: { mode: DashMode; active: NavKey }) {
  const other: DashMode = mode === "paper" ? "live" : "paper";
  return (
    <nav className="flex flex-wrap items-center gap-1">
      {NAV.map((n) => (
        <Link key={n.key} href={`${n.href}?mode=${mode}`} className={`rounded-md px-2.5 py-1 text-sm ${active === n.key ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-100"}`}>{n.label}</Link>
      ))}
      <Link href={`/?mode=${other}`} className="ml-2 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100" title={`Switch dashboard view to ${other} mode`}>
        view {other}
      </Link>
    </nav>
  );
}

/** Shared page header for the secondary pages (the command center has its own live header). */
export function PageHeader({ mode, testnet, active, title, process, children }: { mode: DashMode; testnet?: boolean; active: NavKey; title: string; process?: ProcessView; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Link href={`/?mode=${mode}`} className="text-2xl font-black tracking-[0.3em] text-zinc-100">TALON</Link>
      <ModeBadge mode={mode} testnet={testnet} big={false} />
      {process && <ProcessChip p={process} />}
      <span className="text-sm text-zinc-500">{title}</span>
      {children}
      <div className="ml-auto"><Nav mode={mode} active={active} /></div>
    </header>
  );
}
