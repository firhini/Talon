import type { ScanRow, Trade } from "@talon/core";
import { fmtAgo, fmtDuration, fmtNum, fmtPct, fmtPnl, fmtPrice, fmtQty, fmtRatio, fmtTime, fmtUsd, pnlClass } from "@/lib/format";
import type { BotInfo, BotView, DashboardState, EventRow, PositionView } from "@/lib/state";

export function Panel({ title, right, children, className = "" }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-200">{title}</h2>
        {right && <div className="text-xs text-zinc-500">{right}</div>}
      </header>
      <div>{children}</div>
    </section>
  );
}

function Tile({ label, value, sub, cls = "" }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-[11px] tracking-wide text-zinc-500 uppercase">{label}</div>
      <div className={`num mt-1 text-xl font-semibold ${cls}`}>{value}</div>
      {sub && <div className="num mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

export function StatTiles({ s }: { s: DashboardState }) {
  const bot: BotView | null = s.bot, info: BotInfo | null = s.info;
  // bot_state.equity is already mark-to-market; realized = cash (paper, stored in info.cash) or equity minus open net PnL
  const liveEq = bot ? bot.equity : null;
  const realized = bot ? (typeof info?.cash === "number" ? info.cash : bot.equity - (s.position?.unrealized ?? 0)) : null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Tile label="Equity" value={fmtUsd(liveEq)} sub={bot ? `realized ${fmtUsd(realized)} · peak ${fmtUsd(bot.peakEquity)}` : "no bot state yet"} />
      <Tile label="Today's PnL" value={fmtPnl(s.dayPnl)} sub={s.dayPnlPct !== null ? `${fmtPct(s.dayPnlPct)} vs day start ${fmtUsd(bot?.dayStartEquity)}` : undefined} cls={pnlClass(s.dayPnl)} />
      <Tile label="Drawdown from peak" value={s.drawdownPct !== null ? fmtPct(-s.drawdownPct, 2, true).replace("+", "") : "—"} sub={info?.maxDrawdownPct !== undefined ? `kill switch at -${fmtPct(info.maxDrawdownPct, 1, false)}` : undefined} cls={s.drawdownPct ? (s.drawdownPct >= (info?.maxDrawdownPct ?? 1) * 0.7 ? "text-rose-400" : "text-amber-300") : ""} />
      <Tile label="Leverage / size" value={info?.leverage !== undefined ? `${fmtNum(info.leverage, 0)}x · ${fmtPct(info.sizeFraction, 0, false)}` : "—"} sub={info?.hardStopRoe !== undefined ? `hard stop -${fmtPct(info.hardStopRoe, 0, false)} ROE` : undefined} />
      <Tile label="Daily loss limit" value={info?.dailyLossLimitPct !== undefined ? `-${fmtPct(info.dailyLossLimitPct, 1, false)}` : "—"} sub={bot ? `today ${fmtPct(s.dayPnlPct)} ` : undefined} />
      <Tile label="Strategy" value={info?.strategy ? `${info.strategy} · ${info.interval ?? ""}` : "—"} sub={info?.universe ? info.universe.join(" · ") : undefined} />
    </div>
  );
}

export function PositionCard({ p, now, mode }: { p: PositionView | null; now: number; mode: string }) {
  if (!p) {
    return (
      <Panel title="Open position">
        <div className="px-4 py-8 text-center text-sm text-zinc-500">No open position<div className="mt-1 text-xs text-zinc-600">Waiting for a breakout signal ({mode})</div></div>
      </Panel>
    );
  }
  const long = p.side === "long";
  const Row = ({ k, v, cls = "" }: { k: string; v: string; cls?: string }) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-zinc-800/70 py-1.5 text-sm last:border-0"><span className="text-zinc-500">{k}</span><span className={`num ${cls}`}>{v}</span></div>
  );
  return (
    <Panel title="Open position" right={`held ${fmtDuration(now - p.entryTime)} · ${p.barsHeld} bars`}>
      <div className="px-4 py-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-2xl font-bold">{p.coin}</span>
          <span className={`rounded px-2 py-0.5 text-xs font-bold tracking-wider ${long ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>{p.side.toUpperCase()}</span>
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">{fmtNum(p.leverage, 0)}x</span>
          <span className={`num ml-auto text-xl font-semibold ${pnlClass(p.unrealized)}`}>{fmtPnl(p.unrealized)} <span className="text-sm">({fmtPct(p.roe)} ROE)</span></span>
        </div>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <div>
            <Row k="Qty / notional" v={`${fmtQty(p.qty)} · ${fmtUsd(p.notional)}`} />
            <Row k="Entry" v={fmtPrice(p.entryPrice)} />
            <Row k="Mark" v={p.mark !== null ? fmtPrice(p.mark) : "— (no mid yet)"} />
            <Row k="Margin" v={fmtUsd(p.margin)} />
          </div>
          <div>
            <Row k="Stop" v={`${fmtPrice(p.stopPrice)}  (${p.stopDistancePct !== null ? fmtPct(p.stopDistancePct, 2, false) + " away" : "—"})`} cls={p.stopDistancePct !== null && p.stopDistancePct < 0.005 ? "text-rose-400" : "text-zinc-200"} />
            <Row k="Take profit" v={p.tpPrice ? `${fmtPrice(p.tpPrice)}  (${p.tpDistancePct !== null ? fmtPct(p.tpDistancePct, 2, false) + " away" : "—"})` : "none (trailing)"} />
            <Row k="Open R / fees / funding" v={`${p.openR !== null ? fmtRatio(p.openR) + "R" : "—"} · ${fmtUsd(p.fees)} · ${fmtPnl(p.funding)}`} />
            <Row k="Entered" v={`${fmtTime(p.entryTime)} UTC`} />
          </div>
        </div>
        <div className="mt-2 text-xs text-zinc-500">Reason: <span className="text-zinc-300">{p.reasonEntry}</span></div>
      </div>
    </Panel>
  );
}

const trendCls: Record<string, string> = { up: "text-emerald-400", down: "text-rose-400", flat: "text-zinc-400" };

export function ScanTable({ rows }: { rows: ScanRow[] }) {
  const t = rows[0]?.t;
  return (
    <Panel title="Market scan" right={t ? `${fmtTime(t)} UTC` : "no scan yet"}>
      <div className="scroll-x">
        <table className="data">
          <thead><tr><th>Coin</th><th className="r">Price</th><th>Trend</th><th className="r">ATR %</th><th className="r">Vol ratio</th><th className="r">Breakout high</th><th className="r">Breakout low</th><th>Regime</th><th>Setup</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-zinc-500">Scan runs when the bot starts</td></tr>}
            {rows.map((r) => {
              const signal = r.setup.startsWith("SIGNAL");
              return (
                <tr key={r.coin} className={signal ? "bg-amber-500/10" : ""}>
                  <td className="font-semibold">{r.coin}</td>
                  <td className="r num">{fmtPrice(r.price)}</td>
                  <td className={trendCls[r.trend] ?? ""}>{r.trend} <span className="text-zinc-600">{fmtNum(r.trendStrength, 2)}</span></td>
                  <td className="r num">{fmtPct(r.atrPct, 2, false)}</td>
                  <td className={`r num ${r.volumeRatio >= 1.5 ? "text-amber-300" : ""}`}>{fmtRatio(r.volumeRatio)}x</td>
                  <td className="r num">{fmtPrice(r.levelHigh)} <span className="text-zinc-500">({fmtPct(r.distHighPct, 2, false)})</span></td>
                  <td className="r num">{fmtPrice(r.levelLow)} <span className="text-zinc-500">({fmtPct(r.distLowPct, 2, false)})</span></td>
                  <td className="text-zinc-400">{r.regime}</td>
                  <td className={signal ? "font-semibold text-amber-300" : "text-zinc-400"}>{r.setup}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function TradeTable({ trades, compact = false }: { trades: Trade[]; compact?: boolean }) {
  return (
    <div className="scroll-x">
      <table className="data">
        <thead><tr><th>Exit time (UTC)</th><th>Coin</th><th>Side</th><th className="r">Lev</th><th className="r">Entry</th><th className="r">Exit</th><th className="r">ROE</th><th className="r">PnL</th><th className="r">Fees</th><th className="r">Funding</th>{!compact && <th className="r">Held</th>}<th>Exit reason</th></tr></thead>
        <tbody>
          {trades.length === 0 && <tr><td colSpan={12} className="py-6 text-center text-zinc-500">No trades yet</td></tr>}
          {trades.map((t, i) => (
            <tr key={t.id ?? i}>
              <td className="num text-zinc-400">{fmtTime(t.exitTime)}</td>
              <td className="font-semibold">{t.coin}</td>
              <td className={t.side === "long" ? "text-emerald-400" : "text-rose-400"}>{t.side}</td>
              <td className="r num">{fmtNum(t.leverage, 0)}x</td>
              <td className="r num">{fmtPrice(t.entryPrice)}</td>
              <td className="r num">{fmtPrice(t.exitPrice)}</td>
              <td className={`r num ${pnlClass(t.roe)}`}>{fmtPct(t.roe, 1)}</td>
              <td className={`r num font-medium ${pnlClass(t.pnl)}`}>{fmtPnl(t.pnl)}</td>
              <td className="r num text-zinc-400">{fmtUsd(t.fees)}</td>
              <td className={`r num ${pnlClass(t.funding)}`}>{fmtPnl(t.funding)}</td>
              {!compact && <td className="r num text-zinc-400">{fmtDuration(t.exitTime - t.entryTime)}</td>}
              <td className="max-w-[18rem] truncate text-zinc-400" title={`${t.reasonEntry} → ${t.reasonExit}`}>{t.reasonExit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const levelCls: Record<string, string> = { info: "text-zinc-500", warn: "text-amber-300", error: "text-rose-400", trade: "text-emerald-300" };

export function EventList({ events, now }: { events: EventRow[]; now: number }) {
  return (
    <Panel title="Recent events">
      <ul className="max-h-[22rem] divide-y divide-zinc-800/70 overflow-y-auto text-xs">
        {events.length === 0 && <li className="px-4 py-6 text-center text-zinc-500">No events yet</li>}
        {events.map((e) => (
          <li key={e.id} className="flex gap-3 px-4 py-1.5">
            <span className="num shrink-0 text-zinc-600" title={fmtTime(e.t, true) + " UTC"}>{fmtAgo(now - e.t)} ago</span>
            <span className={`w-10 shrink-0 font-semibold uppercase ${levelCls[e.level] ?? "text-zinc-400"}`}>{e.level}</span>
            <span className="break-words text-zinc-300">{e.msg}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
