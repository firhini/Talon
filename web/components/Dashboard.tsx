"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Controls from "./Controls";
import { ModeBadge, Nav, OtherModeChip, StatusPill } from "./Header";
import LineChart from "./LineChart";
import { EventList, Panel, PositionCard, ScanTable, StatTiles, TradeTable } from "./Panels";
import { fmtAgo, fmtTime, fmtUsd } from "@/lib/format";
import type { DashboardState } from "@/lib/state";

const POLL_MS = 5000;

export default function Dashboard({ initial }: { initial: DashboardState }) {
  const [s, setS] = useState<DashboardState>(initial);
  const [err, setErr] = useState<string | null>(null);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current || document.hidden) return;
    inflight.current = true;
    try {
      const res = await fetch(`/api/state?mode=${initial.mode}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setS((await res.json()) as DashboardState);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      inflight.current = false;
    }
  }, [initial.mode]);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    const onVis = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [refresh]);

  const bot = s.bot;
  // equity rows are already mark-to-market; the dashed realized line strips the open net PnL
  const equityPts = s.equity.map((p) => ({ t: p.t, v: p.equity }));
  const realizedPts = s.equity.map((p) => ({ t: p.t, v: p.equity - p.unrealized }));
  const startEq = s.startEquity ?? undefined;
  const tradeLabel = s.tradeCount > s.trades.length ? `last ${s.trades.length} of ${s.tradeCount}` : `${s.tradeCount} trades`;

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-4 pb-28 sm:px-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-black tracking-[0.3em] text-zinc-100">TALON</span>
          <ModeBadge mode={s.mode} testnet={s.info?.testnet} />
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={bot?.status ?? null} offline={s.offline} halted={bot?.halted ?? false} />
          <span className="text-xs text-zinc-500" suppressHydrationWarning>
            {bot ? `tick ${fmtAgo(s.now - bot.lastTick)} ago` : "no heartbeat"}{err ? ` · refresh failed: ${err}` : ""}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {s.otherModeActive && <OtherModeChip mode={s.mode} />}
          <Nav mode={s.mode} active="dashboard" />
        </div>
      </header>

      {bot?.halted && (
        <div className="rounded-md border border-rose-600/60 bg-rose-950/40 px-4 py-2 text-sm text-rose-200">
          <span className="font-bold">HALTED</span> — {bot.haltReason ?? "no reason recorded"}. Flattened; press <span className="font-semibold">Reset halt</span> then <span className="font-semibold">Start</span> to resume.
        </div>
      )}
      {s.offline && (
        <div className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-300">
          Bot is offline{bot ? ` (last tick ${fmtTime(bot.lastTick)} UTC)` : " (never started in this mode)"}. Commands are queued and consumed on the next tick.
        </div>
      )}

      <Controls mode={s.mode} halted={bot?.halted ?? false} pending={s.pendingCmd} onSent={refresh} />
      <StatTiles s={s} />

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel title="Equity curve" className="xl:col-span-3" right={equityPts.length ? `${equityPts.length} points · from ${fmtTime(s.equity[0].t)} UTC` : undefined}>
          <div className="px-2 pt-3 pb-1">
            <LineChart series={[{ name: "Equity", color: "#f0b429", points: equityPts }, { name: "Realized", color: "#8b8b95", dashed: true, points: realizedPts }]} yFormat="usd" baseline={startEq} emptyText="No equity history yet" height={260} />
          </div>
        </Panel>
        <div className="xl:col-span-2"><PositionCard p={s.position} now={s.now} mode={s.mode} /></div>
      </div>

      <ScanTable rows={s.scan} />

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel title="Trade log" className="xl:col-span-3" right={`${tradeLabel} · total realized ${fmtUsd(s.realizedTotal)}`}>
          <div className="max-h-[32rem] overflow-y-auto"><TradeTable trades={s.trades} /></div>
        </Panel>
        <div className="xl:col-span-2"><EventList events={s.events} now={s.now} /></div>
      </div>
    </div>
  );
}
