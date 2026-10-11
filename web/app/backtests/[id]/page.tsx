import Link from "next/link";
import { notFound } from "next/navigation";
import { getBacktest, type Trade } from "@talon/core";
import { Nav } from "@/components/Header";
import LineChart from "@/components/LineChart";
import { Panel, TradeTable } from "@/components/Panels";
import { asMetrics, asParams, noFeeCurve, type BtMetrics } from "@/lib/backtest";
import { getDb } from "@/lib/db";
import { fmtDate, fmtNum, fmtPct, fmtPnl, fmtRatio, fmtTime, fmtUsd, pnlClass } from "@/lib/format";
import { parseMode } from "@/lib/mode";

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
  const mode = parseMode(sp.mode);
  const n = Number(id);
  const bt = Number.isInteger(n) && n > 0 ? getBacktest(getDb(), n) : null;
  if (!bt) notFound();

  const m = asMetrics(bt.metrics), p = asParams(bt.params);
  const nf = m?.noFees ?? null;
  const curve = (Array.isArray(bt.equityCurve) ? bt.equityCurve : []) as { t: number; equity: number }[];
  const trades = (Array.isArray(bt.trades) ? bt.trades : []) as Trade[];
  const startEquity = Number(p.startEquity ?? curve[0]?.equity ?? 0);
  const series = [{ name: "With fees", color: "#3987e5", points: curve.map((c) => ({ t: c.t, v: c.equity })) }];
  if (nf) series.push({ name: "No fees", color: "#d95926", points: noFeeCurve(trades, startEquity, curve[0]?.t ?? null).map((c) => ({ t: c.t, v: c.equity })), ...{ dashed: true } });
  const exits = Object.entries(m?.exitReasons ?? {}).sort((a, b) => b[1] - a[1]);
  const risk = p.risk ?? {}, fees = p.fees ?? {};
  const paramRows: [string, string][] = [
    ["Strategy", `${p.name ?? "?"} · ${p.interval ?? "?"} (ctx ${p.contextInterval ?? "?"})`],
    ["Universe", (p.coins ?? []).join(", ") || "—"],
    ["Period", m?.from && m?.to ? `${fmtDate(m.from)} → ${fmtDate(m.to)}` : "—"],
    ["Start equity", fmtUsd(startEquity)],
    ["Leverage / size", `${risk.leverage ?? "?"}x · ${risk.sizeFraction !== undefined ? fmtPct(risk.sizeFraction, 0, false) : "?"} · compound ${risk.compound ? "on" : "off"}`],
    ["Hard stop ROE / daily loss / max DD", `${risk.hardStopRoe !== undefined ? fmtPct(risk.hardStopRoe, 0, false) : "?"} · ${risk.dailyLossLimitPct !== undefined ? fmtPct(risk.dailyLossLimitPct, 1, false) : "?"} · ${risk.maxDrawdownPct !== undefined ? fmtPct(risk.maxDrawdownPct, 1, false) : "?"}`],
    ["Fees (taker / slippage / funding h)", `${fees.takerFeeBps ?? "?"} bps · ${fees.slippageBps ?? "?"} bps · ${fees.defaultHourlyFunding ?? "?"}`],
    ["Lookback / vol mult / R / trail ATR", `${p.lookback ?? "?"} · ${String(p.volumeMult ?? "?")}x · ${String(p.rMultiple ?? "?")}R · ${String(p.trailAtrMult ?? "?")}`],
    ["Stop ATR / chase ATR / trend filter", `${String(p.stopAtrMult ?? "?")} · ${String(p.maxChaseAtr ?? "?")} · ${String(p.trendFilter ?? "?")}`],
    ["Kill switch", m?.haltedAt ? `${fmtTime(m.haltedAt)} UTC — ${m.haltReason ?? ""}` : `not triggered${m?.dailyHalts ? ` (${m.dailyHalts} daily halts)` : ""}`],
  ];

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-4 pb-28 sm:px-6">
      <header className="flex flex-wrap items-center gap-4">
        <Link href={`/?mode=${mode}`} className="text-2xl font-black tracking-[0.3em] text-zinc-100">TALON</Link>
        <span className="text-sm text-zinc-500"><Link href={`/backtests?mode=${mode}`} className="hover:text-zinc-200">Backtests</Link> / #{bt.id}</span>
        <div className="ml-auto"><Nav mode={mode} active="backtests" /></div>
      </header>

      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">{bt.label}</h1>
        <span className="text-xs text-zinc-500">saved {fmtTime(bt.createdAt)} UTC</span>
        {m && <span className={`num ml-auto text-2xl font-bold ${pnlClass(m.totalReturnPct)}`}>{fmtPct(m.totalReturnPct, 1)}</span>}
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel title="Equity curve" className="xl:col-span-3">
          <div className="px-2 pt-3 pb-1">
            <LineChart series={series} yFormat="usd" baseline={startEquity || undefined} markerT={m?.haltedAt ?? null} markerLabel="kill switch" height={300} />
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

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel title="Parameters" className="xl:col-span-3">
          <table className="data">
            <tbody>{paramRows.map(([k, v]) => <tr key={k}><td className="w-72 text-zinc-400">{k}</td><td className="num text-zinc-200">{v}</td></tr>)}</tbody>
          </table>
        </Panel>
        <Panel title="Exit reasons" className="xl:col-span-2">
          <table className="data">
            <thead><tr><th>Reason</th><th className="r">Count</th><th className="r">Share</th></tr></thead>
            <tbody>
              {exits.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-zinc-500">No trades</td></tr>}
              {exits.map(([k, v]) => (
                <tr key={k}><td>{k}</td><td className="r num">{v}</td><td className="r num text-zinc-400">{m?.trades ? fmtPct(v / m.trades, 1, false) : "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel title="Trades" right={`${trades.length} trades`}>
        <div className="max-h-[40rem] overflow-y-auto"><TradeTable trades={[...trades].sort((a, b) => b.exitTime - a.exitTime)} /></div>
      </Panel>
    </div>
  );
}
