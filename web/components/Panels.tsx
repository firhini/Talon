import Link from "next/link";
import type { ScanRow, Trade } from "@talon/core";
import { fmtAgo, fmtDuration, fmtNum, fmtPct, fmtPnl, fmtPrice, fmtQty, fmtRatio, fmtTime, fmtUsd, pnlClass } from "@/lib/format";
import { rMultiple } from "@/lib/stats";
import type { DashboardState, EventRow, PositionView } from "@/lib/state";
import { BarStrip, Meter, RiskMeter, Sparkline, type Pt } from "./Charts";

export function Panel({ title, right, children, className = "", bodyClass = "" }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`panel flex min-w-0 flex-col ${className}`}>
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2">
        <h2 className="shrink-0 text-[13px] font-semibold tracking-wide whitespace-nowrap text-zinc-200">{title}</h2>
        {right && <div className="min-w-0 truncate text-[11px] text-zinc-500">{right}</div>}
      </header>
      <div className={`min-w-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Tile({ label, value, sub, cls = "", spark, strip, meter, title }: { label: string; value: string; sub?: React.ReactNode; cls?: string; spark?: { points: Pt[]; baseline?: number; pnl?: boolean; color?: string }; strip?: { points: Pt[]; signed?: boolean }; meter?: { value: number; max: number; danger?: number }; title?: string }) {
  return (
    <div className="panel flex min-w-0 flex-col justify-between px-3.5 py-2.5" title={title}>
      <div className="flex items-start justify-between gap-2">
        <div className="label truncate pt-0.5">{label}</div>
        {spark && <div className="shrink-0"><Sparkline points={spark.points} baseline={spark.baseline} pnl={spark.pnl} color={spark.color} width={84} height={24} /></div>}
        {strip && <div className="shrink-0"><BarStrip points={strip.points} signed={strip.signed} width={84} height={24} /></div>}
      </div>
      <div className={`num mt-0.5 truncate text-[1.3rem] leading-tight font-semibold ${cls}`}>{value}</div>
      {sub && <div className="num mt-0.5 truncate text-[11px] text-zinc-500">{sub}</div>}
      {meter && <div className="mt-1.5"><Meter value={meter.value} max={meter.max} danger={meter.danger} /></div>}
    </div>
  );
}

export function StatTiles({ s }: { s: DashboardState }) {
  const bot = s.bot, info = s.info, st = s.stats;
  const realized = bot ? (typeof info?.cash === "number" ? info.cash : bot.equity - (s.position?.unrealized ?? 0)) : null;
  const pos = s.position;
  const streakTxt = st.streak.kind === "none" ? "—" : `${st.streak.n} ${st.streak.kind === "win" ? "W" : "L"}`;
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
      <Tile label="Equity" value={fmtUsd(bot?.equity)} sub={bot ? `realized ${fmtUsd(realized)} · peak ${fmtUsd(bot.peakEquity)}` : "no bot state yet"} spark={{ points: s.sparks.equity, baseline: s.startEquity ?? undefined }} />
      <Tile label="Today's PnL" value={fmtPnl(s.dayPnl)} cls={pnlClass(s.dayPnl)} sub={s.dayPnlPct !== null ? `${fmtPct(s.dayPnlPct)} vs day start ${fmtUsd(bot?.dayStartEquity)}` : "—"} spark={{ points: s.sparks.today, baseline: 0, pnl: true }} />
      <Tile label="Drawdown from peak" value={s.drawdownPct !== null ? `-${fmtPct(s.drawdownPct, 2, false)}` : "—"} cls={s.drawdownPct ? (s.drawdownPct >= (info?.maxDrawdownPct ?? 1) * 0.7 ? "text-rose-400" : "text-amber-300") : ""} sub={info?.maxDrawdownPct !== undefined ? `kill switch at -${fmtPct(info.maxDrawdownPct, 0, false)}` : "kill switch —"} meter={{ value: s.drawdownPct ?? 0, max: info?.maxDrawdownPct ?? 0.25 }} />
      <Tile label="Realized total" value={fmtPnl(s.realizedTotal)} cls={pnlClass(s.realizedTotal)} sub={`${st.n} trades · gross ${fmtPnl(st.gross, 0)}`} spark={{ points: s.sparks.realized, baseline: 0, pnl: true }} />
      <Tile label="Open position" value={pos ? fmtPnl(pos.unrealized) : "flat"} cls={pos ? pnlClass(pos.unrealized) : "text-zinc-500"} sub={pos ? `${pos.coin} ${pos.side} ${fmtNum(pos.leverage, 0)}x · ROE ${fmtPct(pos.roe, 1)}` : "no open position"} />
      <Tile label="Win rate" value={st.n ? fmtPct(st.winRate, 1, false) : "—"} sub={`PF ${st.profitFactor === null ? "∞" : fmtRatio(st.profitFactor)} · exp ${fmtPnl(st.expectancy)} · ${fmtRatio(st.expectancyR, 2)}R`} spark={{ points: s.stats.rollingWinRate, color: "#3987e5", baseline: 0.5 }} />
      <Tile label="Streak" value={streakTxt} cls={st.streak.kind === "win" ? "text-emerald-400" : st.streak.kind === "loss" ? "text-rose-400" : ""} sub={`longest W ${st.longestWinStreak} · L ${st.longestLossStreak}`} strip={{ points: st.recent }} />
      <Tile label="Best / worst trade" value={st.best ? fmtPnl(st.best.pnl) : "—"} cls={st.best ? "text-emerald-400" : ""} sub={st.worst ? <>worst <span className="text-rose-400">{fmtPnl(st.worst.pnl)}</span> · {st.best?.coin} / {st.worst.coin}</> : "—"} />
      <Tile label="Fees paid" value={fmtUsd(st.fees)} sub={<>funding net <span className={pnlClass(st.funding)}>{fmtPnl(st.funding)}</span></>} spark={{ points: s.sparks.fees, color: "#d95926", baseline: 0 }} />
      <Tile label="Trades today" value={String(st.tradesToday)} sub={`today ${fmtPnl(st.pnlToday)} · 14-day strip`} strip={{ points: st.perDay, signed: false }} />
      <Tile label="Daily loss limit" value={info?.dailyLossLimitPct !== undefined ? `-${fmtPct(info.dailyLossLimitPct, 1, false)}` : "—"} sub={s.dayPnlPct !== null && s.dayPnlPct < 0 ? `used ${fmtPct(-s.dayPnlPct / (info?.dailyLossLimitPct ?? 0.05), 0, false)} of limit` : "nothing lost today"} meter={{ value: s.dayPnlPct !== null && s.dayPnlPct < 0 ? -s.dayPnlPct : 0, max: info?.dailyLossLimitPct ?? 0.05 }} />
      <Tile label="Strategy" value={s.preset ? s.preset.name : info?.strategy ?? "—"} sub={<span className="flex items-center gap-2">{s.preset && <RiskMeter level={s.preset.riskLevel} size="sm" />}{info ? `${info.strategy} · ${info.interval} · ${fmtNum(info.leverage, 0)}x` : "no bot info"}</span>} />
    </div>
  );
}

export function PositionCard({ p, now, mode }: { p: PositionView | null; now: number; mode: string }) {
  if (!p) {
    return (
      <Panel title="Open position" className="h-full">
        <div className="flex h-full flex-col items-center justify-center px-4 py-10 text-center text-sm text-zinc-500">
          <div className="text-2xl font-black tracking-widest text-zinc-700">FLAT</div>
          <div className="mt-1 text-xs text-zinc-600">Waiting for a breakout signal ({mode})</div>
        </div>
      </Panel>
    );
  }
  const long = p.side === "long";
  const stopRisk = Math.abs(p.entryPrice - p.stopPrice) * p.qty;
  const Row = ({ k, v, cls = "" }: { k: string; v: React.ReactNode; cls?: string }) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-zinc-800/70 py-1 text-[13px] last:border-0"><span className="text-zinc-500">{k}</span><span className={`num text-right ${cls}`}>{v}</span></div>
  );
  return (
    <Panel title="Open position" className="h-full" right={`in trade ${fmtDuration(now - p.entryTime)} · ${p.barsHeld} bars`}>
      <div className="px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-2xl font-black">{p.coin}</span>
          <span className={`rounded px-2 py-0.5 text-xs font-bold tracking-wider ${long ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>{p.side.toUpperCase()}</span>
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">{fmtNum(p.leverage, 0)}x</span>
          {(p.maxUnits ?? 1) > 1 || (p.units ?? 1) > 1 ? <span className="rounded bg-sky-500/15 px-2 py-0.5 text-xs text-sky-300" title="pyramiding units">{p.units ?? 1}/{p.maxUnits ?? "?"} units</span> : null}
          <span className={`num ml-auto text-xl font-semibold ${pnlClass(p.unrealized)}`}>{fmtPnl(p.unrealized)} <span className="text-sm">({fmtPct(p.roe, 1)} ROE)</span></span>
        </div>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <div>
            <Row k="Qty / notional" v={`${fmtQty(p.qty)} · ${fmtUsd(p.notional)}`} />
            <Row k="Entry → mark" v={`${fmtPrice(p.entryPrice)} → ${p.mark !== null ? fmtPrice(p.mark) : "— (no mid yet)"}`} />
            <Row k="Margin / risk at stop" v={`${fmtUsd(p.margin)} · ${fmtUsd(stopRisk)}`} />
            <Row k="Open R / fees / funding" v={`${p.openR !== null ? fmtRatio(p.openR) + "R" : "—"} · ${fmtUsd(p.fees)} · ${fmtPnl(p.funding)}`} />
          </div>
          <div>
            <Row k="Stop" v={`${fmtPrice(p.stopPrice)} (${p.stopDistancePct !== null ? fmtPct(p.stopDistancePct, 2, false) + " away" : "—"})`} cls={p.stopDistancePct !== null && p.stopDistancePct < 0.005 ? "text-rose-400" : "text-zinc-200"} />
            <Row k="Take profit" v={p.tpPrice ? `${fmtPrice(p.tpPrice)} (${p.tpDistancePct !== null ? fmtPct(p.tpDistancePct, 2, false) + " away" : "—"})` : "none (trailing)"} />
            <Row k="Next add level" v={p.nextAddPrice !== null ? fmtPrice(p.nextAddPrice) : (p.maxUnits ?? 1) > 1 ? "— (max units)" : "n/a"} />
            <Row k="Liq. reference / entered" v={`${p.liqPrice !== null ? fmtPrice(p.liqPrice) : "—"} · ${fmtTime(p.entryTime)}`} />
          </div>
        </div>
        {p.stopDistancePct !== null && (
          <div className="mt-2">
            <div className="mb-1 flex justify-between text-[10px] text-zinc-500"><span>stop {fmtPrice(p.stopPrice)}</span><span>mark {fmtPrice(p.mark)}</span><span>{p.tpPrice ? `tp ${fmtPrice(p.tpPrice)}` : "trailing"}</span></div>
            <Meter value={Math.max(0, p.stopDistancePct)} max={Math.max(p.stopDistancePct, Math.abs(p.entryPrice - p.initialStop) / p.entryPrice) || 1} danger={0.3} />
          </div>
        )}
        <div className="mt-2 truncate text-[11px] text-zinc-500" title={p.reasonEntry}>Reason: <span className="text-zinc-300">{p.reasonEntry}</span></div>
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
                  <td className={signal ? "font-semibold text-amber-300" : "text-zinc-400"}>{signal && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400 align-middle" />}{r.setup}</td>
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
        <thead><tr><th>Exit time (UTC)</th><th>Coin</th><th>Side</th><th className="r">Lev</th><th className="r">Units</th><th className="r">Entry</th><th className="r">Exit</th><th className="r">R</th><th className="r">ROE</th><th className="r">PnL</th><th className="r">Fees</th><th className="r">Funding</th>{!compact && <th className="r">Held</th>}<th>Exit reason</th></tr></thead>
        <tbody>
          {trades.length === 0 && <tr><td colSpan={14} className="py-6 text-center text-zinc-500">No trades yet</td></tr>}
          {trades.map((t, i) => {
            const r = rMultiple(t);
            return (
              <tr key={t.id ?? i} className="hover:bg-zinc-800/30">
                <td className="num text-zinc-400">{fmtTime(t.exitTime)}</td>
                <td className="font-semibold">{t.coin}</td>
                <td className={t.side === "long" ? "text-emerald-400" : "text-rose-400"}>{t.side}</td>
                <td className="r num">{fmtNum(t.leverage, 0)}x</td>
                <td className="r num text-zinc-400">{t.units ?? 1}</td>
                <td className="r num">{fmtPrice(t.entryPrice)}</td>
                <td className="r num">{fmtPrice(t.exitPrice)}</td>
                <td className={`r num ${pnlClass(r)}`}>{r === null ? "—" : fmtRatio(r, 2)}</td>
                <td className={`r num ${pnlClass(t.roe)}`}>{fmtPct(t.roe, 1)}</td>
                <td className={`r num font-medium ${pnlClass(t.pnl)}`}>{fmtPnl(t.pnl)}</td>
                <td className="r num text-zinc-400">{fmtUsd(t.fees)}</td>
                <td className={`r num ${pnlClass(t.funding)}`}>{fmtPnl(t.funding)}</td>
                {!compact && <td className="r num text-zinc-400">{fmtDuration(t.exitTime - t.entryTime)}</td>}
                <td className="max-w-[18rem] truncate text-zinc-400" title={`${t.reasonEntry} → ${t.reasonExit}`}>{t.reasonExit}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const levelCls: Record<string, string> = { info: "text-zinc-500", warn: "text-amber-300", error: "text-rose-400", trade: "text-emerald-300" };

export function EventList({ events, now, className = "" }: { events: EventRow[]; now: number; className?: string }) {
  return (
    <Panel title="Events" className={className} right={`${events.length} recent`}>
      <ul className="scroll-y max-h-[26rem] divide-y divide-zinc-800/70 overflow-y-auto text-xs">
        {events.length === 0 && <li className="px-4 py-6 text-center text-zinc-500">No events yet</li>}
        {events.map((e) => (
          <li key={e.id} className="flex gap-3 px-4 py-1.5">
            <span className="num w-16 shrink-0 text-zinc-600" title={fmtTime(e.t, true) + " UTC"}>{fmtAgo(now - e.t)} ago</span>
            <span className={`w-10 shrink-0 font-semibold uppercase ${levelCls[e.level] ?? "text-zinc-400"}`}>{e.level}</span>
            <span className="break-words text-zinc-300">{e.msg}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** First-run wizard: shown until candles exist; steps tick off as the DB fills. */
export function Wizard({ s, onFetch, onBacktests, onStart, busy }: { s: DashboardState; onFetch: () => void; onBacktests: () => void; onStart: () => void; busy: string | null }) {
  const steps = [
    { n: 1, done: s.candleCount > 0, label: "Fetch 400 days of candles + funding", action: <button className="btn btn-warn btn-sm" disabled={busy !== null || !!s.jobs.running} onClick={onFetch}>{s.jobs.running?.kind === "fetch" ? "fetching…" : "Fetch data"}</button> },
    { n: 2, done: s.backtestCount > 0, label: "Run the backtests for every preset", action: <button className="btn btn-default btn-sm" disabled={busy !== null || s.candleCount === 0} onClick={onBacktests}>Run backtests</button> },
    { n: 3, done: s.preset !== null, label: "Pick a preset in the Strategy lab", action: <Link className="btn btn-default btn-sm" href={`/strategies?mode=${s.mode}`}>Open Strategy lab</Link> },
    { n: 4, done: s.process.status === "running", label: "Start the paper bot", action: <button className="btn btn-good btn-sm" disabled={busy !== null || s.process.status === "running"} onClick={onStart}>Start paper</button> },
  ];
  return (
    <div className="panel border-amber-500/30 bg-amber-500/5 px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-sm"><span className="chip border-amber-500/50 text-amber-300">FIRST RUN</span><span className="text-zinc-300">Nothing to trade on yet — four steps, all from here.</span></div>
      <ol className="grid gap-2 md:grid-cols-4">
        {steps.map((st) => (
          <li key={st.n} className={`panel-2 flex items-center gap-3 px-3 py-2 ${st.done ? "opacity-60" : ""}`}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${st.done ? "bg-emerald-500/20 text-emerald-300" : "bg-zinc-800 text-zinc-300"}`}>{st.done ? "✓" : st.n}</span>
            <span className="min-w-0 flex-1 text-xs text-zinc-300">{st.label}</span>
            {!st.done && st.action}
          </li>
        ))}
      </ol>
    </div>
  );
}
