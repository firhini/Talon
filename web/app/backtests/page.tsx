import Link from "next/link";
import { listBacktests } from "@talon/core";
import { BacktestListActions } from "@/components/BacktestActions";
import { PageHeader } from "@/components/Header";
import { Panel } from "@/components/Panels";
import { summarize } from "@/lib/backtest";
import { getDb } from "@/lib/db";
import { effectiveConfig } from "@/lib/effective";
import { fmtDate, fmtNum, fmtPct, fmtRatio, fmtTime, pnlClass } from "@/lib/format";
import { resolveMode } from "@/lib/state";
import { getSupervisor } from "@/lib/supervisor";

export const dynamic = "force-dynamic";

export default async function BacktestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const db = getDb();
  const mode = resolveMode(db, (await searchParams).mode);
  const rows = listBacktests(db, 200).map(summarize);
  const cfg = effectiveConfig(db);
  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-3 pb-24 sm:px-6">
      <PageHeader mode={mode} testnet={cfg.testnet} active="backtests" title="Backtests" process={getSupervisor().process()} />
      <Panel title="Saved backtests" right={<BacktestListActions count={rows.length} />}>
        <div className="scroll-x">
          <table className="data">
            <thead><tr><th className="r">#</th><th>Label</th><th>Preset</th><th>Created (UTC)</th><th>Strategy</th><th>Period</th><th className="r">Trades</th><th className="r">Win rate</th><th className="r">PF</th><th className="r">Exp. R</th><th className="r">Sharpe</th><th className="r">Return</th><th className="r">Max DD</th><th className="r">No-fee</th><th>MC</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={15} className="py-8 text-center text-zinc-500">No backtests saved yet — use <b>Run all preset backtests</b> or the Strategy lab</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-zinc-800/40">
                  <td className="r num text-zinc-500">{r.id}</td>
                  <td><Link href={`/backtests/${r.id}?mode=${mode}`} className="font-medium text-amber-300 hover:underline">{r.label}</Link></td>
                  <td>{r.presetId ? <span className="chip border-zinc-700 text-zinc-300">{r.presetId}</span> : <span className="text-zinc-600">—</span>}</td>
                  <td className="num text-zinc-400">{fmtTime(r.createdAt)}</td>
                  <td className="text-zinc-300">{r.strategy} · {r.interval}</td>
                  <td className="num text-zinc-400">{r.from && r.to ? `${fmtDate(r.from)} → ${fmtDate(r.to)}` : "—"}</td>
                  <td className="r num">{fmtNum(r.trades, 0)}</td>
                  <td className="r num">{fmtPct(r.winRate, 1, false)}</td>
                  <td className="r num">{r.profitFactor === null ? "∞" : fmtRatio(r.profitFactor)}</td>
                  <td className={`r num ${pnlClass(r.expectancyR)}`}>{fmtRatio(r.expectancyR, 2)}</td>
                  <td className="r num">{fmtRatio(r.sharpe)}</td>
                  <td className={`r num font-medium ${pnlClass(r.totalReturnPct)}`}>{fmtPct(r.totalReturnPct, 1)}</td>
                  <td className="r num text-rose-300">-{fmtPct(r.maxDrawdownPct, 1, false)}</td>
                  <td className={`r num ${pnlClass(r.noFeeReturnPct)}`}>{fmtPct(r.noFeeReturnPct, 1)}</td>
                  <td>{r.hasMc ? <span className="text-sky-300" title="Monte-Carlo available">MC</span> : <span className="text-zinc-700">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
