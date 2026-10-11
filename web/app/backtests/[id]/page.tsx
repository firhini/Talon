import Link from "next/link";
import { notFound } from "next/navigation";
import { getBacktest, type Trade } from "@talon/core";
import { BacktestDetailActions } from "@/components/BacktestActions";
import { Donut, HBars, Histogram, McStrip, MonthHeatmap } from "@/components/Charts";
import { PageHeader } from "@/components/Header";
import LineChart from "@/components/LineChart";
import { Panel, TradeTable } from "@/components/Panels";
import { asMetrics, asParams, mcSentence, noFeeCurve, presetForLabel, type BtMetrics } from "@/lib/backtest";
import { getDb } from "@/lib/db";
import { effectiveConfig } from "@/lib/effective";
import { fmtDate, fmtMult, fmtNum, fmtPct, fmtPnl, fmtRatio, fmtTime, fmtUsd, pnlClass } from "@/lib/format";
import { resolveMode } from "@/lib/state";
import { drawdownSeries, tradeStats } from "@/lib/stats";
import { getSupervisor } from "@/lib/supervisor";

export const dynamic = "force-dynamic";

type Row = { k: string; f: (m: BtMetrics) => string; cls?: (m: BtMetrics) => string };
const ROWS: Row[] = [
  { k: "Trades (L / S)", f: (m) => `${fmtNum(m.trades, 0)} (${fmtNum(m.longs, 0)} / ${fmtNum(m.shorts, 0)})` },
  { k: "Win rate", f: (m) => fmtPct(m.winRate, 1, false) },
  { k: "Expectancy ($)", f: (m) => fmtPnl(m.expectancy), cls: (m) => pnlClass(m.expectancy) },
  { k: "Expectancy (R)", f: (m) => fmtRatio(m.expectancyR, 3) + "R", cls: (m) => pnlClass(m.expectancyR) },
  { k: "Profit factor", f: (m) => (m.profitFactor === null ? "∞" : fmtRatio(m.profitFactor)) },
  { k: "Avg win / avg loss", f: (m) => `${fmtUsd(m.avgWin)} / ${fmtUsd(m.avgLoss)}` },
  { k: "Max drawdown", f: (m) => "-" + fmtPct(m.maxDrawdownPct, 2, false), cls: () => "text-rose-300" },
  { k: "Total return", f: (m) => fmtPct(m.totalReturnPct, 2), cls: (m) => pnlClass(m.totalReturnPct) },
  { k: "Final equity", f: (m) => fmtUsd(m.finalEquity) },
  { k: "Sharpe (daily, ann.)", f: (m) => fmtRatio(m.sharpe) },
  { k: "Calmar", f: (m) => fmtRatio(m.calmar) },
  { k: "Avg hold", f: (m) => `${fmtRatio(m.avgHoldHours, 1)}h` },
  { k: "Fees paid", f: (m) => fmtUsd(m.totalFees) },
  { k: "Funding (net)", f: (m) => fmtPnl(m.totalFunding), cls: (m) => pnlClass(m.totalFunding) },
];

export default async function BacktestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const db = getDb();
  const mode = resolveMode(db, sp.mode);
  const n = Number(id);
  const bt = Number.isInteger(n) && n > 0 ? getBacktest(db, n) : null;
  if (!bt) notFound();
  const cfg = effectiveConfig(db);

  const m = asMetrics(bt.metrics), p = asParams(bt.params);
  const nf = m?.noFees ?? null;
  const curve = (Array.isArray(bt.equityCurve) ? bt.equityCurve : []) as { t: number; equity: number }[];
  const trades = (Array.isArray(bt.trades) ? bt.trades : []) as Trade[];
  const startEquity = Number(p.startEquity ?? curve[0]?.equity ?? 0);
  const series = [{ name: "With fees", color: "#3987e5", points: curve.map((c) => ({ t: c.t, v: c.equity })) }];
  if (nf) series.push({ name: "No fees", color: "#d95926", points: noFeeCurve(trades, startEquity, curve[0]?.t ?? null).map((c) => ({ t: c.t, v: c.equity })), ...{ dashed: true } });
  const dd = drawdownSeries(curve.map((c) => ({ t: c.t, v: c.equity })));
  const st = tradeStats(trades, Number(m?.to ?? Date.now()));
  const risk = p.risk ?? {}, fees = p.fees ?? {};
  const presetId = presetForLabel(bt.label);
  const paramRows: [string, string][] = [
    // guard: sweep rows store an object under `interval` — never print "[object Object]"
    ["Strategy", `${typeof p.name === "string" ? p.name : "?"} · ${typeof p.interval === "string" ? p.interval : "?"} (ctx ${typeof p.contextInterval === "string" ? p.contextInterval : "?"})`],
    ["Universe", (p.coins ?? []).join(", ") || "—"],
    ["Period", m?.from && m?.to ? `${fmtDate(m.from)} → ${fmtDate(m.to)} (${Math.round((m.to - m.from) / 86_400_000)} days)` : "—"],
    ["Start equity", fmtUsd(startEquity)],
    ["Leverage / size / risk per trade", `${risk.leverage ?? "?"}x${risk.dynamicLeverage ? " dynamic" : ""} (max ${risk.maxLeverage ?? "?"}x) · ${risk.sizeFraction !== undefined ? fmtPct(risk.sizeFraction, 0, false) : "?"} · ${risk.riskPerTradePct !== undefined ? fmtPct(risk.riskPerTradePct, 1, false) : "?"} · compound ${risk.compound ? "on" : "off"}`],
    ["Hard stop ROE / daily loss / max DD", `${risk.hardStopRoe !== undefined ? fmtPct(risk.hardStopRoe, 0, false) : "?"} · ${risk.dailyLossLimitPct !== undefined ? fmtPct(risk.dailyLossLimitPct, 1, false) : "?"} · ${risk.maxDrawdownPct !== undefined ? fmtPct(risk.maxDrawdownPct, 1, false) : "?"}`],
    ["Fees (taker / slippage / funding h)", `${fees.takerFeeBps ?? "?"} bps · ${fees.slippageBps ?? "?"} bps · ${fees.defaultHourlyFunding ?? "?"}`],
    ["Lookback / vol mult / R / trail ATR", `${p.lookback ?? "?"} · ${String(p.volumeMult ?? "?")}x · ${String(p.rMultiple ?? "?")}R · ${String(p.trailAtrMult ?? "?")}`],
    ["Stop ATR / chase ATR / trend filter / ER min", `${String(p.stopAtrMult ?? "?")} · ${String(p.maxChaseAtr ?? "?")} · ${String(p.trendFilter ?? "?")} · ${String(p.regimeErMin ?? "0")}`],
    ["Pyramiding", `${String(p.maxUnits ?? 1)} unit${Number(p.maxUnits ?? 1) > 1 ? `s, add every ${String(p.addEveryAtr ?? "?")} ATR` : ""}`],
    ["Kill switch", m?.haltedAt ? `${fmtTime(m.haltedAt)} UTC — ${m.haltReason ?? ""}` : `not triggered${m?.dailyHalts ? ` (${m.dailyHalts} daily halts)` : ""}`],
  ];

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-3 pb-24 sm:px-6">
      <PageHeader mode={mode} testnet={cfg.testnet} active="backtests" title="" process={getSupervisor().process()}>
        <span className="text-sm text-zinc-500"><Link href={`/backtests?mode=${mode}`} className="hover:text-zinc-200">Backtests</Link> / #{bt.id}</span>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{bt.label}</h1>
        {presetId && <Link href={`/strategies?mode=${mode}`} className="chip border-zinc-700 text-zinc-300 hover:border-zinc-500">preset {presetId}</Link>}
        <span className="text-xs text-zinc-500">saved {fmtTime(bt.createdAt)} UTC</span>
        <BacktestDetailActions id={bt.id} mode={mode} />
        {m && <span className={`num ml-auto text-2xl font-bold ${pnlClass(m.totalReturnPct)}`}>{fmtPct(m.totalReturnPct, 1)}</span>}
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel title="Equity curve & drawdown" className="xl:col-span-3">
          <div className="px-2 pt-3 pb-1">
            <LineChart series={series} yFormat="usd" baseline={startEquity || undefined} markerT={m?.haltedAt ?? null} markerLabel="kill switch" height={300} />
          </div>
          <div className="border-t border-zinc-800/70 px-2 pt-2 pb-1">
            <LineChart series={[{ name: "Drawdown", color: "#fb7185", points: dd }]} yFormat="pct" baseline={0} fillFrom="baseline" yMin={-0.05} yMax={0} height={120} />
          </div>
        </Panel>
        <Panel title="Metrics" className="xl:col-span-2">
          <table className="data">
            <thead><tr><th>Metric</th><th className="r">With fees</th><th className="r">No fees</th></tr></thead>
            <tbody>
              {!m && <tr><td colSpan={3} className="py-6 text-center text-zinc-500">No metrics stored</td></tr>}
              {m && ROWS.map((r) => (
                <tr key={r.k}>
                  <td className="text-zinc-400">{r.k}</td>
                  <td className={`r num ${r.cls?.(m) ?? ""}`}>{r.f(m)}</td>
                  <td className={`r num ${nf ? r.cls?.(nf) ?? "" : "text-zinc-600"}`}>{nf ? r.f(nf) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      {m?.mc && (
        <Panel title="Monte-Carlo — bootstrap of the trade sequence" right={`${m.mc.paths.toLocaleString("en-US")} paths · ${st.n} trades resampled with full compounding`}>
          <div className="grid gap-4 px-4 py-3 xl:grid-cols-5">
            <div className="xl:col-span-3">
              <McStrip mc={m.mc} />
              <p className="mt-2 text-sm leading-relaxed text-zinc-300">{mcSentence(m.mc)}</p>
              <p className="mt-1 text-xs text-zinc-500">Trades are drawn with replacement from this backtest&apos;s per-trade returns (pnl ÷ equity before the trade), so the distribution assumes the same edge persists; it says nothing about regime change.</p>
            </div>
            <table className="data xl:col-span-2">
              <tbody>
                {([["p5", m.mc.p5], ["p25", m.mc.p25], ["median", m.mc.p50], ["p75", m.mc.p75], ["p95", m.mc.p95]] as [string, number][]).map(([k, v]) => <tr key={k}><td className="text-zinc-400">Final equity {k}</td><td className={`r num ${v >= 1 ? "text-emerald-400" : "text-rose-400"}`}>{fmtMult(v)}</td></tr>)}
                <tr><td className="text-zinc-400">P(drawdown &gt; 50 %)</td><td className="r num text-amber-300">{fmtPct(m.mc.pDd50, 1, false)}</td></tr>
                <tr><td className="text-zinc-400">P(ruin, drawdown &gt; 90 %)</td><td className="r num text-rose-300">{fmtPct(m.mc.pDd90, 1, false)}</td></tr>
                <tr><td className="text-zinc-400">P(ending below start)</td><td className="r num">{fmtPct(m.mc.pLoss, 1, false)}</td></tr>
                <tr><td className="text-zinc-400">Median max drawdown</td><td className="r num text-rose-300">-{fmtPct(m.mc.medianMaxDd, 1, false)}</td></tr>
                <tr><td className="text-zinc-400">Mean return per trade</td><td className={`r num ${pnlClass(m.mc.meanTradePct)}`}>{fmtPct(m.mc.meanTradePct, 3)}</td></tr>
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="R-multiple distribution" right={`avg ${fmtRatio(st.expectancyR, 2)}R`} bodyClass="px-2 pt-2 pb-1"><Histogram bins={st.rHistogram} height={150} /></Panel>
        <Panel title="Monthly PnL" right={`${st.monthly.filter((x) => x.pnl > 0).length} up · ${st.monthly.filter((x) => x.pnl <= 0).length} down`} bodyClass="px-3 pt-2 pb-2"><MonthHeatmap monthly={st.monthly} /></Panel>
        <Panel title="PnL by coin" bodyClass="px-2 pt-2 pb-1"><HBars rows={st.perCoin} /></Panel>
        <Panel title="Exit reasons" bodyClass="px-3 py-3"><Donut rows={st.exitReasons} /></Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel title="Parameters" className="xl:col-span-3">
          <table className="data">
            <tbody>{paramRows.map(([k, v]) => <tr key={k}><td className="w-80 text-zinc-400">{k}</td><td className="num text-zinc-200">{v}</td></tr>)}</tbody>
          </table>
        </Panel>
        <div className="grid gap-4 xl:col-span-2">
          <Panel title="By coin">
            <table className="data dense">
              <thead><tr><th>Coin</th><th className="r">Trades</th><th className="r">Win</th><th className="r">PnL</th><th className="r">Share</th></tr></thead>
              <tbody>{st.perCoin.map((c) => <tr key={c.key}><td className="font-semibold">{c.key}</td><td className="r num">{c.n}</td><td className="r num">{fmtPct(c.wins / c.n, 0, false)}</td><td className={`r num ${pnlClass(c.pnl)}`}>{fmtPnl(c.pnl)}</td><td className="r num text-zinc-500">{st.net !== 0 ? fmtPct(c.pnl / Math.abs(st.net), 0, false) : "—"}</td></tr>)}</tbody>
            </table>
          </Panel>
          <Panel title="By month">
            <div className="scroll-y max-h-64 overflow-y-auto">
              <table className="data dense">
                <thead><tr><th>Month</th><th className="r">Trades</th><th className="r">Win</th><th className="r">PnL</th><th className="r">vs start</th></tr></thead>
                <tbody>{st.monthly.map((c) => <tr key={c.key}><td>{c.key}</td><td className="r num">{c.n}</td><td className="r num">{fmtPct(c.wins / c.n, 0, false)}</td><td className={`r num ${pnlClass(c.pnl)}`}>{fmtPnl(c.pnl)}</td><td className={`r num ${pnlClass(c.pnl)}`}>{startEquity ? fmtPct(c.pnl / startEquity, 1) : "—"}</td></tr>)}</tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="Trades" right={`${trades.length} trades · ${st.longs} long / ${st.shorts} short`}>
        <div className="scroll-y max-h-[40rem] overflow-y-auto"><TradeTable trades={[...trades].sort((a, b) => b.exitTime - a.exitTime)} /></div>
      </Panel>
    </div>
  );
}
