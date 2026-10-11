import Link from "next/link";
import { listBacktests } from "@talon/core";
import { Nav } from "@/components/Header";
import { Panel } from "@/components/Panels";
import { summarize } from "@/lib/backtest";
import { getDb } from "@/lib/db";
import { fmtNum, fmtPct, fmtRatio, fmtTime, pnlClass, fmtDate } from "@/lib/format";
import { parseMode } from "@/lib/mode";

export const dynamic = "force-dynamic";

export default async function BacktestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const mode = parseMode((await searchParams).mode);
  const rows = listBacktests(getDb(), 100).map(summarize);
  return (
    <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-4 pb-28 sm:px-6">
      <header className="flex flex-wrap items-center gap-4">
        <Link href={`/?mode=${mode}`} className="text-2xl font-black tracking-[0.3em] text-zinc-100">TALON</Link>
        <span className="text-sm text-zinc-500">Backtests</span>
        <div className="ml-auto"><Nav mode={mode} active="backtests" /></div>
      </header>
      <Panel title="Saved backtests" right={`${rows.length} saved`}>
        <div className="scroll-x">
          <table className="data">
            <thead><tr><th className="r">#</th><th>Label</th><th>Created (UTC)</th><th>Strategy</th><th>Period</th><th className="r">Trades</th><th className="r">Win rate</th><th className="r">Profit factor</th><th className="r">Return</th><th className="r">Max DD</th><th className="r">No-fee return</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={11} className="py-8 text-center text-zinc-500">No backtests saved yet — run <code className="mono text-zinc-300">npm run backtest</code> to create one</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-zinc-800/40">
                  <td className="r num text-zinc-500">{r.id}</td>
                  <td><Link href={`/backtests/${r.id}?mode=${mode}`} className="font-medium text-amber-300 hover:underline">{r.label}</Link></td>
                  <td className="num text-zinc-400">{fmtTime(r.createdAt)}</td>
                  <td className="text-zinc-300">{r.strategy} · {r.interval}</td>
                  <td className="num text-zinc-400">{r.from && r.to ? `${fmtDate(r.from)} → ${fmtDate(r.to)}` : "—"}</td>
                  <td className="r num">{fmtNum(r.trades, 0)}</td>
                  <td className="r num">{fmtPct(r.winRate, 1, false)}</td>
                  <td className="r num">{r.profitFactor === null ? "∞" : fmtRatio(r.profitFactor)}</td>
                  <td className={`r num font-medium ${pnlClass(r.totalReturnPct)}`}>{fmtPct(r.totalReturnPct, 1)}</td>
                  <td className="r num text-rose-300">-{fmtPct(r.maxDrawdownPct, 1, false)}</td>
                  <td className={`r num ${pnlClass(r.noFeeReturnPct)}`}>{fmtPct(r.noFeeReturnPct, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
