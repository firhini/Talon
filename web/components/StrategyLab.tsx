"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { EDITABLE_SETTINGS } from "@talon/core";
import { mcSentence } from "@/lib/mc";
import { api, poll } from "@/lib/client";
import { fmtMult, fmtNum, fmtPct, fmtRatio, fmtTime, fmtUsd, pnlClass } from "@/lib/format";
import type { PresetCardData, PresetsPayload } from "@/lib/payloads";
import { McStrip, RiskMeter } from "./Charts";
import { ConfirmDialog } from "./LiveDialog";
import { Panel } from "./Panels";

type Editable = typeof EDITABLE_SETTINGS;
const KEY_PARAMS: [string, string][] = [["CANDLE_INTERVAL", "tf"], ["LOOKBACK", "lookback"], ["STOP_ATR_MULT", "stop ATR"], ["R_MULTIPLE", "target R"], ["TRAIL_ATR_MULT", "trail ATR"], ["TREND_FILTER", "trend"], ["REGIME_ER_MIN", "ER min"], ["LEVERAGE", "lev"], ["SIZE_FRACTION", "size"], ["RISK_PER_TRADE_PCT", "risk/trade"], ["COMPOUND", "compound"], ["MAX_UNITS", "units"], ["MAX_DRAWDOWN_PCT", "kill DD"], ["DAILY_LOSS_LIMIT_PCT", "daily loss"]];

export default function StrategyLab({ initial, editable, effective, mode }: { initial: PresetsPayload; editable: Editable; effective: Record<string, string>; mode: string }) {
  const [d, setD] = useState(initial);
  const [eff, setEff] = useState(effective);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PresetCardData | null>(null);
  const [compare, setCompare] = useState(false);

  useEffect(() => poll<{ presets: PresetsPayload["presets"]; active: PresetsPayload["active"]; botRunning: boolean; botMode: PresetsPayload["botMode"] }>(() => "/api/presets", 5000, (b) => setD(b)), []);
  const refreshEff = async () => { try { const b = await api<{ values: Record<string, string> }>("/api/settings"); setEff(b.values); } catch { /* ignore */ } };

  const act = async (key: string, f: () => Promise<string>) => {
    setBusy(key);
    try { setNote(await f()); } catch (e) { setNote(`Error: ${(e as Error).message}`); } finally { setBusy(null); setConfirm(null); setTimeout(() => setNote(null), 8000); }
  };
  const activate = (p: PresetCardData) => act(`act:${p.id}`, async () => {
    const r = await api<PresetsPayload & { restarted: boolean; stopped: boolean }>("/api/presets", { action: "activate", id: p.id });
    setD(r); void refreshEff();
    return `${p.name} activated${r.restarted ? " — bot restarted with the new preset" : r.stopped ? " — LIVE bot stopped; press Go live to start it with the new preset" : ""}`;
  });
  const runBt = (p: PresetCardData) => act(`bt:${p.id}`, async () => { const r = await api<{ jobId: number }>("/api/presets", { action: "run-backtest", id: p.id }); return `Backtest job #${r.jobId} queued for ${p.name} — the card updates when it finishes`; });
  const runAll = () => act("all", async () => { const r = await api<{ jobIds: number[] }>("/api/presets", { action: "run-all" }); return `Queued ${r.jobIds.length} backtest jobs`; });

  const active = d.presets.find((p) => p.active) ?? null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-zinc-400">A preset is a bundle of strategy + risk settings. <b className="text-zinc-200">Activate</b> writes it to the settings table{d.botRunning ? " and restarts the running bot" : ""}; <b className="text-zinc-200">Run backtest</b> re-runs it on the stored candles with fees, slippage and funding.</p>
        <div className="ml-auto flex items-center gap-2">
          <button className={`btn ${compare ? "btn-warn" : "btn-default"}`} onClick={() => setCompare(!compare)}>⇄ Compare</button>
          <button className="btn btn-default" disabled={busy !== null} onClick={runAll}>Run all backtests</button>
        </div>
      </div>
      {note && <div role="status" className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs text-zinc-200">{note}</div>}

      {compare && <ComparePanel presets={d.presets} mode={mode} />}

      <div className="grid gap-4 xl:grid-cols-3">
        {d.presets.map((p) => <PresetCard key={p.id} p={p} mode={mode} busy={busy} onActivate={() => (p.riskLevel >= 4 ? setConfirm(p) : void activate(p))} onBacktest={() => void runBt(p)} />)}
      </div>

      {active && <AdvancedParams active={active} editable={editable} effective={eff} botRunning={d.botRunning} onSaved={() => { void refreshEff(); }} onReset={() => act("reset", async () => { const r = await api<PresetsPayload>("/api/presets", { action: "reset-overrides" }); setD(r); void refreshEff(); return "Overrides removed — settings match the preset again"; })} />}

      <ConfirmDialog open={confirm !== null} danger title={`Activate ${confirm?.name}?`} confirmLabel={`Yes, activate risk ${confirm?.riskLevel}/5`} busy={busy !== null} onClose={() => setConfirm(null)} onConfirm={() => confirm && void activate(confirm)}
        body={<div className="space-y-2"><p>{confirm?.tagline}</p><ul className="list-disc space-y-1 pl-5 text-rose-300">{confirm?.warnings.map((w) => <li key={w}>{w}</li>)}</ul>{d.botRunning && <p className="text-zinc-300">The running {d.botMode} bot will be {d.botMode === "live" ? "stopped" : "restarted"} with this preset.</p>}</div>} />
    </div>
  );
}

function PresetCard({ p, mode, busy, onActivate, onBacktest }: { p: PresetCardData; mode: string; busy: string | null; onActivate: () => void; onBacktest: () => void }) {
  const [more, setMore] = useState(false);
  const bt = p.backtest, m = p.metrics;
  const danger = p.riskLevel >= 5, warn = p.riskLevel === 4;
  const nOver = Object.keys(p.overrides).length;
  return (
    <section className={`panel flex flex-col ${p.active ? "ring-1 ring-amber-400/70" : ""} ${danger ? "border-rose-900/60" : ""}`}>
      <header className="flex items-start gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-zinc-100">{p.name}</h3>
            {p.active && <span className="chip border-amber-500/50 bg-amber-500/10 text-amber-300">ACTIVE{nOver ? ` · ${nOver} override${nOver > 1 ? "s" : ""}` : ""}</span>}
            {danger && <span className="chip border-rose-500/50 bg-rose-500/10 text-rose-300">RISK 5 — CAN LOSE EVERYTHING</span>}
          </div>
          <p className="mt-1 text-xs text-zinc-400">{p.tagline}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1"><RiskMeter level={p.riskLevel} /><span className="text-[10px] text-zinc-500">risk {p.riskLevel}/5</span></div>
      </header>
      <div className="flex flex-1 flex-col gap-3 px-4 py-3">
        <p className={`text-xs leading-relaxed text-zinc-300 ${more ? "" : "line-clamp-4"}`}>{p.description}</p>
        {p.description.length > 220 && <button className="self-start text-[11px] text-zinc-500 hover:text-zinc-300" onClick={() => setMore(!more)}>{more ? "less ▴" : "read more ▾"}</button>}
        <div className={`rounded-md border px-3 py-2 text-xs ${danger ? "border-rose-700/60 bg-rose-950/40 text-rose-200" : warn ? "border-amber-700/60 bg-amber-950/30 text-amber-200" : "border-zinc-800 bg-zinc-900/60 text-zinc-400"}`}>
          <div className="mb-1 font-semibold">{danger ? "Warnings" : "Notes"}</div>
          <ul className="list-disc space-y-0.5 pl-4">{p.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
        <div className="flex flex-wrap gap-1">
          {KEY_PARAMS.filter(([k]) => k in p.env).map(([k, label]) => <span key={k} className="chip border-zinc-800 bg-zinc-900 font-normal text-zinc-400"><span className="text-zinc-600">{label}</span> <span className="num text-zinc-200">{fmtEnv(k, p.env[k])}</span></span>)}
        </div>
        <div className="panel-2 px-3 py-2">
          <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
            <span>Latest backtest · {bt ? <Link href={`/backtests/${bt.id}?mode=${mode}`} className="text-amber-300 hover:underline">#{bt.id}</Link> : "none yet"}</span>
            {bt && <span>{fmtTime(bt.createdAt)} UTC · {bt.from && bt.to ? `${Math.round((bt.to - bt.from) / 86_400_000)} d` : ""}</span>}
          </div>
          {m ? (
            <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
              <Stat k="Return" v={fmtPct(m.totalReturnPct, 1)} cls={pnlClass(m.totalReturnPct)} big />
              <Stat k="Profit factor" v={m.profitFactor === null ? "∞" : fmtRatio(m.profitFactor)} />
              <Stat k="Win rate" v={fmtPct(m.winRate, 1, false)} />
              <Stat k="Max DD" v={`-${fmtPct(m.maxDrawdownPct, 1, false)}`} cls="text-rose-300" />
              <Stat k="Sharpe" v={fmtRatio(m.sharpe)} />
              <Stat k="Trades" v={`${fmtNum(m.trades, 0)} · ${fmtUsd(m.totalFees, 0)} fees`} />
            </div>
          ) : <div className="py-2 text-xs text-zinc-600">Run a backtest to see fees-included numbers here.</div>}
          {p.mc && (
            <div className="mt-2 border-t border-zinc-800 pt-2">
              <div className="mb-1 text-[11px] text-zinc-500">Monte-Carlo · {p.mc.paths.toLocaleString("en-US")} resampled sequences · median {fmtMult(p.mc.p50)} · ruin {fmtPct(p.mc.pDd90, 0, false)}</div>
              <McStrip mc={p.mc} />
              <p className="mt-1 text-[11px] leading-snug text-zinc-400">{mcSentence(p.mc)}</p>
            </div>
          )}
        </div>
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <button className={`btn ${danger ? "btn-bad" : "btn-good"}`} disabled={busy !== null || p.active} onClick={onActivate}>{p.active ? "Active" : "Activate"}</button>
          <button className="btn btn-default" disabled={busy !== null} onClick={onBacktest}>Run backtest</button>
          {bt && <Link className="btn btn-ghost" href={`/backtests/${bt.id}?mode=${mode}`}>Report →</Link>}
        </div>
      </div>
    </section>
  );
}

function Stat({ k, v, cls = "", big = false }: { k: string; v: string; cls?: string; big?: boolean }) {
  return <div><div className="text-[10px] text-zinc-500 uppercase">{k}</div><div className={`num ${big ? "text-base font-semibold" : "text-sm"} ${cls}`}>{v}</div></div>;
}

function fmtEnv(k: string, v: string): string {
  if (["SIZE_FRACTION", "RISK_PER_TRADE_PCT", "MAX_DRAWDOWN_PCT", "DAILY_LOSS_LIMIT_PCT"].includes(k)) return fmtPct(Number(v), 0, false);
  if (k === "LEVERAGE") return `${v}x`;
  return v;
}

function ComparePanel({ presets, mode }: { presets: PresetCardData[]; mode: string }) {
  const rows: { k: string; f: (p: PresetCardData) => string; cls?: (p: PresetCardData) => string }[] = [
    { k: "Backtest", f: (p) => (p.backtest ? `#${p.backtest.id} · ${fmtTime(p.backtest.createdAt).slice(0, 10)}` : "—") },
    { k: "Total return (with fees)", f: (p) => (p.metrics ? fmtPct(p.metrics.totalReturnPct, 1) : "—"), cls: (p) => pnlClass(p.metrics?.totalReturnPct) },
    { k: "Return without fees", f: (p) => (p.metrics?.noFees ? fmtPct(p.metrics.noFees.totalReturnPct, 1) : "—") },
    { k: "Final equity", f: (p) => (p.metrics ? fmtUsd(p.metrics.finalEquity) : "—") },
    { k: "Profit factor", f: (p) => (p.metrics ? (p.metrics.profitFactor === null ? "∞" : fmtRatio(p.metrics.profitFactor)) : "—") },
    { k: "Win rate", f: (p) => (p.metrics ? fmtPct(p.metrics.winRate, 1, false) : "—") },
    { k: "Expectancy (R)", f: (p) => (p.metrics ? `${fmtRatio(p.metrics.expectancyR, 3)}R` : "—") },
    { k: "Max drawdown", f: (p) => (p.metrics ? `-${fmtPct(p.metrics.maxDrawdownPct, 1, false)}` : "—"), cls: () => "text-rose-300" },
    { k: "Sharpe (daily)", f: (p) => (p.metrics ? fmtRatio(p.metrics.sharpe) : "—") },
    { k: "Trades (L/S)", f: (p) => (p.metrics ? `${p.metrics.trades} (${p.metrics.longs}/${p.metrics.shorts})` : "—") },
    { k: "Avg hold", f: (p) => (p.metrics ? `${fmtRatio(p.metrics.avgHoldHours, 1)} h` : "—") },
    { k: "Fees / funding", f: (p) => (p.metrics ? `${fmtUsd(p.metrics.totalFees, 0)} / ${fmtUsd(p.metrics.totalFunding, 0)}` : "—") },
    { k: "Kill switch", f: (p) => (p.metrics ? (p.metrics.haltedAt ? `hit ${fmtTime(p.metrics.haltedAt).slice(0, 10)}` : "not hit") : "—") },
    { k: "MC median / p5 / p95", f: (p) => (p.mc ? `${fmtMult(p.mc.p50)} / ${fmtMult(p.mc.p5)} / ${fmtMult(p.mc.p95)}` : "—") },
    { k: "MC P(>50 % DD) / ruin / loss", f: (p) => (p.mc ? `${fmtPct(p.mc.pDd50, 0, false)} / ${fmtPct(p.mc.pDd90, 0, false)} / ${fmtPct(p.mc.pLoss, 0, false)}` : "—") },
    { k: "Leverage · size · risk/trade", f: (p) => `${p.env.LEVERAGE ?? "?"}x · ${fmtPct(Number(p.env.SIZE_FRACTION ?? 0), 0, false)} · ${fmtPct(Number(p.env.RISK_PER_TRADE_PCT ?? 0), 0, false)}` },
    { k: "Kill DD · daily loss", f: (p) => `${fmtPct(Number(p.env.MAX_DRAWDOWN_PCT ?? 0), 0, false)} · ${fmtPct(Number(p.env.DAILY_LOSS_LIMIT_PCT ?? 0), 0, false)}` },
  ];
  return (
    <Panel title="Side by side — latest backtest per preset">
      <div className="scroll-x">
        <table className="data">
          <thead><tr><th>Metric</th>{presets.map((p) => <th key={p.id} className="r">{p.name} <span className="font-normal text-zinc-600">risk {p.riskLevel}</span>{p.active && <span className="ml-1 text-amber-300">●</span>}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.k}><td className="text-zinc-400">{r.k}</td>{presets.map((p) => <td key={p.id} className={`r num ${r.cls?.(p) ?? ""}`}>{r.k === "Backtest" && p.backtest ? <Link href={`/backtests/${p.backtest.id}?mode=${mode}`} className="text-amber-300 hover:underline">{r.f(p)}</Link> : r.f(p)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </Panel>
  );
}

function AdvancedParams({ active, editable, effective, botRunning, onSaved, onReset }: { active: PresetCardData; editable: Editable; effective: Record<string, string>; botRunning: boolean; onSaved: () => void; onReset: () => void }) {
  const fields = useMemo(() => editable.filter((e) => e.group === "Strategy" || e.group === "Risk"), [editable]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setDraft({}); }, [active.id, effective]);
  const value = (k: string) => draft[k] ?? effective[k] ?? active.env[k] ?? "";
  const dirty = Object.keys(draft).filter((k) => draft[k] !== (effective[k] ?? active.env[k] ?? ""));
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const values: Record<string, string> = {};
      for (const k of dirty) values[k] = draft[k];
      const r = await api<{ restartNeeded: boolean }>("/api/settings", { values }, "PUT");
      setMsg(`Saved ${dirty.length} override${dirty.length > 1 ? "s" : ""}${r.restartNeeded ? " — restart the bot to apply" : ""}`);
      setDraft({}); onSaved();
    } catch (e) { setMsg(`Error: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  return (
    <Panel title={`Advanced parameters — overrides on top of ${active.name}`} right={botRunning ? "bot running: changes apply after a restart" : undefined}>
      <div className="grid gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-2 xl:grid-cols-4">
        {fields.map((f) => {
          const v = value(f.key), presetV = active.env[f.key], over = f.key in active.overrides;
          return (
            <label key={f.key} className="block text-xs">
              <span className="flex items-center gap-1.5 text-zinc-400">{f.label}{over && <span className="chip border-amber-500/40 text-amber-300">override</span>}{draft[f.key] !== undefined && draft[f.key] !== (effective[f.key] ?? "") && <span className="text-amber-300">•</span>}</span>
              {f.type === "select" ? (
                <select className="input mt-1" value={v} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
              ) : f.type === "boolean" ? (
                <select className="input mt-1" value={v || "false"} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}><option value="true">true</option><option value="false">false</option></select>
              ) : (
                <input className="input mono mt-1" type={f.type === "number" ? "number" : "text"} step="any" value={v} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              )}
              <span className="mt-0.5 block truncate text-[10px] text-zinc-600" title={f.help}>{presetV !== undefined ? `preset: ${presetV}` : "not in preset"}{f.help ? ` · ${f.help}` : ""}</span>
            </label>
          );
        })}
      </div>
      <div className="flex items-center gap-2 border-t border-zinc-800 px-4 py-2">
        <button className="btn btn-warn" disabled={busy || dirty.length === 0} onClick={() => void save()}>{busy ? "Saving…" : `Save ${dirty.length || ""} override${dirty.length === 1 ? "" : "s"}`}</button>
        <button className="btn btn-default" disabled={busy} onClick={onReset}>Reset to preset</button>
        {msg && <span className="text-xs text-zinc-300">{msg}</span>}
      </div>
    </Panel>
  );
}
