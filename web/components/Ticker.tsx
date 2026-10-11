"use client";
import { useEffect, useState } from "react";
import { fmtCompact, fmtPct, fmtPrice } from "@/lib/format";
import type { Ticker as TickerData, TickerRow } from "@/lib/ticker";

const POLL_MS = 10_000;

/** Live market strip: price, 24h change, funding (annualised), open interest, 24h volume per universe coin. */
export default function Ticker({ initial, highlight }: { initial: TickerData | null; highlight?: string | null }) {
  const [t, setT] = useState<TickerData | null>(initial);
  useEffect(() => {
    let stop = false;
    const load = async () => {
      if (document.hidden) return;
      try { const r = await fetch("/api/ticker", { cache: "no-store" }); if (r.ok && !stop) setT((await r.json()) as TickerData); } catch { /* keep last */ }
    };
    if (!initial) void load();
    const id = setInterval(load, POLL_MS);
    const onVis = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [initial]);

  const rows = t?.rows ?? [];
  return (
    <div className="panel scroll-x flex items-stretch gap-0 overflow-x-auto py-0" aria-label="market ticker">
      <div className="flex shrink-0 items-center gap-1.5 border-r border-zinc-800 px-3 text-[10px] tracking-wider text-zinc-500 uppercase">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${t && !t.stale ? "bg-emerald-400" : "bg-zinc-600"}`} />Hyperliquid
      </div>
      {rows.length === 0 && <div className="px-4 py-2.5 text-xs text-zinc-500">{t?.error ? `ticker unavailable: ${t.error}` : "loading market data…"}</div>}
      {rows.map((r) => <Cell key={r.coin} r={r} hot={highlight === r.coin} />)}
    </div>
  );
}

function Cell({ r, hot }: { r: TickerRow; hot: boolean }) {
  const up = r.change24h >= 0;
  return (
    <div className={`flex shrink-0 items-center gap-3 border-r border-zinc-800 px-3 py-1.5 ${hot ? "bg-amber-500/5" : ""}`} title={`${r.coin}: mark ${fmtPrice(r.mark)} · oracle ${fmtPrice(r.oracle)} · premium ${fmtPct(r.premium, 3)} · max ${r.maxLeverage}x`}>
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-bold text-zinc-100">{r.coin}</span>
          <span className="rounded bg-zinc-800 px-1 text-[9px] text-zinc-400">{r.maxLeverage}x</span>
        </div>
        <div className="num text-sm text-zinc-200">{fmtPrice(r.mark)}</div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0 text-[10px] leading-tight">
        <span className="text-zinc-500">24h</span><span className={`num text-right ${up ? "text-emerald-400" : "text-rose-400"}`}>{fmtPct(r.change24h, 2)}</span>
        <span className="text-zinc-500">fund/y</span><span className={`num text-right ${r.fundingAnnual > 0.3 ? "text-amber-300" : r.fundingAnnual < 0 ? "text-emerald-400" : "text-zinc-300"}`}>{fmtPct(r.fundingAnnual, 1)}</span>
        <span className="text-zinc-500">OI</span><span className="num text-right text-zinc-300">{fmtCompact(r.openInterestUsd, true)}</span>
        <span className="text-zinc-500">vol</span><span className="num text-right text-zinc-300">{fmtCompact(r.volume24hUsd, true)}</span>
      </div>
    </div>
  );
}
