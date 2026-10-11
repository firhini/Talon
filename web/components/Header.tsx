import Link from "next/link";
import type { DashMode } from "@/lib/mode";

export function ModeBadge({ mode, testnet, big = true }: { mode: DashMode; testnet?: boolean; big?: boolean }) {
  const size = big ? "px-4 py-1.5 text-lg tracking-[0.2em]" : "px-2 py-0.5 text-xs tracking-widest";
  if (mode === "live" && testnet) {
    return <span className={`rounded-md border-2 border-red-500 font-bold text-red-400 ${size}`}>LIVE · TESTNET</span>;
  }
  if (mode === "live") {
    return <span className={`pulse-live rounded-md bg-red-600 font-bold text-white ${size}`}>LIVE</span>;
  }
  return <span className={`rounded-md bg-amber-500 font-bold text-black ${size}`}>PAPER</span>;
}

export function StatusPill({ status, offline, halted }: { status: string | null; offline: boolean; halted: boolean }) {
  if (offline) return <span className="rounded-full border border-zinc-600 bg-zinc-800 px-2.5 py-0.5 text-xs font-semibold text-zinc-300">OFFLINE</span>;
  const s = halted ? "halted" : status ?? "unknown";
  const cls: Record<string, string> = {
    running: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
    paused: "bg-amber-500/15 text-amber-300 border-amber-500/40",
    halted: "bg-rose-500/15 text-rose-300 border-rose-500/40",
    stopped: "bg-zinc-500/15 text-zinc-300 border-zinc-500/40",
  };
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls[s] ?? cls.stopped}`}>
      {s === "running" && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 align-middle" />}
      {s.toUpperCase()}
    </span>
  );
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

export function Nav({ mode, active }: { mode: DashMode; active: "dashboard" | "backtests" }) {
  const link = (href: string, label: string, key: string) => (
    <Link href={href} className={`rounded-md px-2.5 py-1 text-sm ${active === key ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-100"}`}>{label}</Link>
  );
  const other: DashMode = mode === "paper" ? "live" : "paper";
  return (
    <nav className="flex items-center gap-1">
      {link(`/?mode=${mode}`, "Dashboard", "dashboard")}
      {link(`/backtests?mode=${mode}`, "Backtests", "backtests")}
      <Link href={`/?mode=${other}`} className="ml-2 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100" title={`Switch dashboard view to ${other} mode`}>
        view {other}
      </Link>
    </nav>
  );
}
