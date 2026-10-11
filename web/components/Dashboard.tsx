"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { fmtAgo, fmtDate, fmtPct, fmtTime, fmtUsd } from "@/lib/format";
import type { DashboardState } from "@/lib/state";
import type { Ticker as TickerData } from "@/lib/ticker";
import { Donut, HBars, Histogram, MonthHeatmap, RiskMeter } from "./Charts";
import Controls from "./Controls";
import { ModeBadge, Nav, OtherModeChip, ProcessChip, StatusPill } from "./Header";
import LineChart from "./LineChart";
import LogDrawer from "./LogDrawer";
import { EventList, Panel, PositionCard, ScanTable, StatTiles, TradeTable, Wizard } from "./Panels";
import Ticker from "./Ticker";

const POLL_MS = 5000;

export default function Dashboard({ initial, ticker }: { initial: DashboardState; ticker: TickerData | null }) {
  const [s, setS] = useState<DashboardState>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
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

  const act = async (key: string, f: () => Promise<string>) => {
    setBusy(key);
    try { setNote(await f()); } catch (e) { setNote(`Error: ${(e as Error).message}`); } finally { setBusy(null); void refresh(); setTimeout(() => setNote(null), 6000); }
  };
  const fetchJob = () => act("fetch", async () => { const r = await api<{ id: number }>("/api/jobs", { kind: "fetch", args: { from: fmtDate(Date.now() - 400 * 86_400_000) } }); return `Fetch job #${r.id} queued — watch it in the log drawer or on /system`; });
  const allBacktests = () => act("bt", async () => { const r = await api<{ jobIds: number[] }>("/api/presets", { action: "run-all" }); return `Queued ${r.jobIds.length} backtest jobs (#${r.jobIds.join(", #")})`; });
  const startPaper = () => act("start", async () => { await api("/api/process", { action: "start", mode: "paper" }); return "Paper bot started"; });

  const bot = s.bot;
  const equityPts = s.equity.map((p) => ({ t: p.t, v: p.equity }));
  const realizedPts = s.equity.map((p) => ({ t: p.t, v: p.equity - p.unrealized }));
  const startEq = s.startEquity ?? undefined;
  const tradeLabel = s.tradeCount > s.trades.length ? `last ${s.trades.length} of ${s.tradeCount}` : `${s.tradeCount} trades`;
  const tickAgo = bot ? s.now - bot.lastTick : null;
  const restartNeeded = s.process.status === "running" && s.preset && s.info?.strategy && s.process.preset && s.process.preset !== s.preset.id;

  return (
    <div className="grid-bg min-h-screen">
      <div className="mx-auto max-w-[1600px] space-y-3 px-4 py-3 pb-20 sm:px-6">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-black tracking-[0.3em] text-zinc-100">TALON</span>
            <ModeBadge mode={s.mode} testnet={s.info?.testnet ?? s.testnet} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ProcessChip p={s.process} lastTickAgoMs={tickAgo} />
            <StatusPill status={bot?.status ?? null} offline={s.offline} halted={bot?.halted ?? false} reason={bot?.haltReason} />
            {s.preset && (
              <Link href={`/strategies?mode=${s.mode}`} className="chip border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500" title={s.preset.tagline}>
                {s.preset.name} <RiskMeter level={s.preset.riskLevel} size="sm" />
              </Link>
            )}
            <span className="num text-[11px] text-zinc-500" suppressHydrationWarning>
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
        {s.process.status === "crashed" && (
          <div className="rounded-md border border-rose-600/60 bg-rose-950/40 px-4 py-2 text-sm text-rose-200">
            <span className="font-bold">BOT PROCESS EXITED</span> unexpectedly (code {s.process.lastExit?.code ?? "?"}{s.process.lastExit?.signal ? `, ${s.process.lastExit.signal}` : ""} at {fmtTime(s.process.lastExit?.at)} UTC). Check the log drawer below, then start it again.
          </div>
        )}
        {s.offline && s.process.status !== "running" && !s.firstRun && (
          <div className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-300">
            The {s.mode} bot is not running{bot ? ` (last tick ${fmtTime(bot.lastTick)} UTC)` : " (never started in this mode)"}. Press <b>Start {s.mode === "live" ? "live" : "paper bot"}</b> — the dashboard spawns and supervises it.
          </div>
        )}
        {s.offline && s.process.status === "running" && s.process.mode === s.mode && (
          <div className="rounded-md border border-amber-600/50 bg-amber-950/30 px-4 py-2 text-sm text-amber-200">
            Bot process is up (pid {s.process.pid}) but has not written a heartbeat for {bot ? fmtAgo(s.now - bot.lastTick) : "a while"} — it may still be starting (asset metadata, first scan) or stuck. See the log drawer.
          </div>
        )}
        {restartNeeded && (
          <div className="rounded-md border border-sky-600/50 bg-sky-950/30 px-4 py-2 text-sm text-sky-200">
            Preset <b>{s.preset?.name}</b> is active but the running bot was started with <b>{s.process.preset}</b> — <b>Restart</b> to apply.
          </div>
        )}
        {s.firstRun && <Wizard s={s} onFetch={fetchJob} onBacktests={allBacktests} onStart={startPaper} busy={busy} />}
        {note && <div role="status" className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs text-zinc-200">{note}</div>}

        <Ticker initial={ticker} highlight={s.position?.coin ?? null} />
        <Controls s={s} onChanged={refresh} />
        <StatTiles s={s} />

        <div className="grid gap-3 xl:grid-cols-5">
          <Panel title="Equity & drawdown" className="xl:col-span-3" right={equityPts.length ? `${equityPts.length} points · since ${fmtTime(s.equity[0].t)} UTC · peak ${fmtUsd(bot?.peakEquity)}` : undefined}>
            <div className="px-2 pt-3 pb-1">
              <LineChart series={[{ name: "Equity", color: "#f0b429", points: equityPts }, { name: "Realized", color: "#8b8b95", dashed: true, points: realizedPts }]} yFormat="usd" baseline={startEq} emptyText="No equity history yet — start the bot" height={230} />
            </div>
            <div className="border-t border-zinc-800/70 px-2 pt-2 pb-1">
              <LineChart series={[{ name: "Drawdown", color: "#fb7185", points: s.drawdown }]} yFormat="pct" baseline={0} fillFrom="baseline" yMin={-0.05} yMax={0} emptyText="" height={110} />
            </div>
          </Panel>
          <div className="xl:col-span-2"><PositionCard p={s.position} now={s.now} mode={s.mode} /></div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Panel title="R-multiple distribution" right={`${s.stats.n} trades · avg ${s.stats.expectancyR.toFixed(2)}R`} bodyClass="px-2 pt-2 pb-1">
            <Histogram bins={s.stats.rHistogram} height={150} />
          </Panel>
          <Panel title="Monthly PnL" right={s.stats.monthly.length ? `${s.stats.monthly.filter((m) => m.pnl > 0).length} up · ${s.stats.monthly.filter((m) => m.pnl <= 0).length} down` : undefined} bodyClass="px-3 pt-2 pb-2">
            <MonthHeatmap monthly={s.stats.monthly} />
          </Panel>
          <Panel title="PnL by coin" right={s.stats.perCoin[0] ? `best ${s.stats.perCoin[0].key}` : undefined} bodyClass="px-2 pt-2 pb-1">
            <HBars rows={s.stats.perCoin} />
          </Panel>
          <Panel title="Exit reasons" bodyClass="px-3 py-3">
            <Donut rows={s.stats.exitReasons} />
          </Panel>
        </div>

        <div className="grid gap-3 xl:grid-cols-5">
          <div className="xl:col-span-3"><ScanTable rows={s.scan} /></div>
          <EventList events={s.events} now={s.now} className="xl:col-span-2" />
        </div>

        <Panel title="Trade log" right={`${tradeLabel} · realized ${fmtUsd(s.realizedTotal)} · win ${fmtPct(s.stats.winRate, 0, false)}`}>
          <div className="scroll-y max-h-[32rem] overflow-y-auto"><TradeTable trades={s.trades} /></div>
        </Panel>
      </div>
      <LogDrawer jobs={s.jobs.recent} title={s.jobs.running ? `Logs · job #${s.jobs.running.id} ${s.jobs.running.kind} running` : "Logs"} />
    </div>
  );
}
