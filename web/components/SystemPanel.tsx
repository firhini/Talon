"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, poll } from "@/lib/client";
import { fmtAgo, fmtBytes, fmtDate, fmtDuration, fmtNum, fmtTime, fmtUptime, fmtUsd } from "@/lib/format";
import type { SystemPayload } from "@/lib/payloads";
import type { JobView } from "@/lib/supervisor";
import { Panel } from "./Panels";

const STATUS_CLS: Record<string, string> = { queued: "border-zinc-600 text-zinc-300", running: "border-sky-500/50 text-sky-300", done: "border-emerald-500/50 text-emerald-300", failed: "border-rose-500/50 text-rose-300", cancelled: "border-amber-500/50 text-amber-300" };

export default function SystemPanel({ initial, mode }: { initial: SystemPayload; mode: string }) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [from, setFrom] = useState(fmtDate(initial.now - 400 * 86_400_000));
  const [validateFrom, setValidateFrom] = useState(fmtDate(initial.now - 150 * 86_400_000));
  const [viewJob, setViewJob] = useState<number | null>(null);
  const [jobLog, setJobLog] = useState<string>("");
  const [follow, setFollow] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => poll<SystemPayload>(() => "/api/system?lines=200", 5000, setD), []);
  useEffect(() => {
    if (viewJob === null) return;
    let stop = false;
    const load = async () => { try { const r = await api<{ job: JobView }>(`/api/jobs/${viewJob}?tail=400`); if (!stop) setJobLog(r.job.logTail); } catch { /* ignore */ } };
    void load();
    const id = setInterval(load, 3000);
    return () => { stop = true; clearInterval(id); };
  }, [viewJob]);
  useEffect(() => { if (follow && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [d.log, jobLog, follow]);

  const act = async (key: string, f: () => Promise<string>) => {
    setBusy(key);
    try { setMsg(await f()); } catch (e) { setMsg(`Error: ${(e as Error).message}`); } finally { setBusy(null); setTimeout(() => setMsg(null), 8000); }
  };
  const fetchData = () => act("fetch", async () => { const r = await api<{ id: number }>("/api/jobs", { kind: "fetch", args: { from } }); setViewJob(r.id); return `Fetch job #${r.id} queued`; });
  const runAll = () => act("all", async () => { const r = await api<{ jobIds: number[] }>("/api/presets", { action: "run-all" }); setViewJob(r.jobIds[0]); return `Queued ${r.jobIds.length} backtest jobs`; });
  const sweep = () => act("sweep", async () => { const r = await api<{ id: number }>("/api/jobs", { kind: "sweep", args: { validateFrom } }); setViewJob(r.id); return `Sweep job #${r.id} queued (this takes a while; top 10 variants are saved as backtests)`; });
  const scan = () => act("scan", async () => { const r = await api<{ id: number }>("/api/jobs", { kind: "scan", args: {} }); setViewJob(r.id); return `Scan job #${r.id} queued`; });
  const cancel = (id: number) => act(`cancel:${id}`, async () => { await api(`/api/jobs/${id}`, { action: "cancel" }); return `Job #${id} cancelled`; });
  const proc = (action: "start" | "stop" | "restart") => act(action, async () => { await api("/api/process", { action, mode: "paper" }); return `bot ${action} ok`; });

  const p = d.process;
  const botRow = d.bots.find((b) => b.mode === (p.mode ?? "paper"));
  const running = d.jobs.find((j) => j.status === "running");
  return (
    <div className="space-y-4">
      {msg && <div role="status" className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs text-zinc-200">{msg}</div>}
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Bot process" right={p.logPath}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-3 text-sm">
            <K k="Status" v={<span className={`font-semibold ${p.status === "running" ? "text-sky-300" : p.status === "crashed" ? "text-rose-300" : "text-zinc-300"}`}>{p.status.toUpperCase()}{p.external ? " (adopted)" : ""}</span>} />
            <K k="Mode / preset" v={`${p.mode ?? "—"} / ${p.preset ?? "—"}`} />
            <K k="PID" v={p.pid ?? "—"} />
            <K k="Uptime" v={fmtUptime(p.uptimeMs)} />
            <K k="Started" v={p.startedAt ? `${fmtTime(p.startedAt)} UTC` : "—"} />
            <K k="Restarts" v={p.restarts} />
            <K k="Last tick" v={botRow ? <span suppressHydrationWarning>{fmtAgo(d.now - botRow.lastTick)} ago · {botRow.status}{botRow.halted ? " · HALTED" : ""}</span> : "—"} />
            <K k="Equity" v={botRow ? fmtUsd(botRow.equity) : "—"} />
            <K k="Last exit" v={p.lastExit ? `${fmtTime(p.lastExit.at)} · code ${p.lastExit.code ?? "?"}${p.lastExit.signal ? ` ${p.lastExit.signal}` : ""}${p.lastExit.requested ? " (requested)" : ""}` : "—"} />
            <K k="Built" v={p.built ? "bot/dist ✓" : <span className="text-rose-300">bot not built</span>} />
          </div>
          <div className="flex flex-wrap gap-2 border-t border-zinc-800 px-4 py-2">
            {p.status !== "running" && p.status !== "stopping" && <button className="btn btn-good btn-sm" disabled={busy !== null || !p.built} onClick={() => proc("start")}>▶ Start paper</button>}
            {(p.status === "running" || p.status === "stopping") && <button className="btn btn-bad btn-sm" disabled={busy !== null} onClick={() => proc("stop")}>■ Stop</button>}
            {p.status === "running" && p.mode === "paper" && <button className="btn btn-default btn-sm" disabled={busy !== null} onClick={() => proc("restart")}>↻ Restart</button>}
            <Link href={`/?mode=${mode}`} className="btn btn-ghost btn-sm">Command center →</Link>
          </div>
        </Panel>

        <Panel title="Data" right={`DB ${fmtBytes(d.db.sizeBytes)}`}>
          <div className="scroll-y max-h-56 overflow-y-auto">
            <table className="data dense">
              <thead><tr><th>Coin</th><th>Interval</th><th className="r">Candles</th><th>From</th><th>To</th><th className="r">Age</th></tr></thead>
              <tbody>
                {d.coverage.candles.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-zinc-500">No candles yet — fetch data below</td></tr>}
                {d.coverage.candles.map((c) => <tr key={`${c.source}-${c.coin}-${c.interval}`}><td className="font-semibold">{c.coin}</td><td className="text-zinc-400">{c.interval} <span className="text-zinc-600">{c.source}</span></td><td className="r num">{fmtNum(c.n, 0)}</td><td className="num text-zinc-400">{fmtDate(c.min)}</td><td className="num text-zinc-400">{fmtDate(c.max)}</td><td className={`r num ${d.now - c.max > 3 * 86_400_000 ? "text-amber-300" : "text-zinc-400"}`} suppressHydrationWarning>{fmtDuration(d.now - c.max)}</td></tr>)}
                {d.coverage.funding.map((f) => <tr key={`f-${f.coin}`}><td className="font-semibold">{f.coin}</td><td className="text-zinc-400">funding</td><td className="r num">{fmtNum(f.n, 0)}</td><td className="num text-zinc-400">{fmtDate(f.min)}</td><td className="num text-zinc-400">{fmtDate(f.max)}</td><td className="r num text-zinc-400" suppressHydrationWarning>{fmtDuration(d.now - f.max)}</td></tr>)}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 px-4 py-2">
            <label className="flex items-center gap-1 text-xs text-zinc-400">from <input className="input mono w-36" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <button className="btn btn-warn btn-sm" disabled={busy !== null || !!running} onClick={fetchData}>⇣ Fetch / update data</button>
            <span className="text-[11px] text-zinc-600">OKX candles (15m/1h/4h) + Hyperliquid funding; resumes from what is stored</span>
          </div>
        </Panel>

        <Panel title="Research jobs" right={`${d.counts.backtests} backtests saved`}>
          <div className="space-y-3 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-default btn-sm" disabled={busy !== null} onClick={runAll}>Run all preset backtests</button>
              <span className="text-[11px] text-zinc-500">one job per preset, labelled so the Strategy lab picks them up</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-zinc-400">validate from <input className="input mono w-36" type="date" value={validateFrom} onChange={(e) => setValidateFrom(e.target.value)} /></label>
              <button className="btn btn-default btn-sm" disabled={busy !== null} onClick={sweep}>Run sweep</button>
              <span className="text-[11px] text-zinc-500">parameter grid, in-sample / out-of-sample split</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-default btn-sm" disabled={busy !== null} onClick={scan}>Market scan now</button>
              <span className="text-[11px] text-zinc-500">one-off scan with the current settings</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-zinc-800 px-4 py-2 text-xs text-zinc-400">
            <K k="TALON" v={d.versions.talon} /><K k="Node" v={d.versions.node} /><K k="Next" v={d.versions.next} /><K k="React" v={d.versions.react} /><K k="sqlite" v={d.versions.sqlite} /><K k="Platform" v={d.versions.platform} />
            <K k="Build" v={`core ${d.build.core ? "✓" : "✗"} · bot ${d.build.bot ? "✓" : "✗"} · web ${d.build.web ? "✓" : "✗"}`} /><K k="Web up" v={<span suppressHydrationWarning>{fmtUptime(d.now - d.webStartedAt)}</span>} />
            <K k="DB" v={<span className="mono break-all">{d.db.path}</span>} /><K k=".env" v={<span className="mono break-all">{d.envFile}</span>} />
            <K k="Rows" v={`${fmtNum(d.counts.candles, 0)} candles · ${fmtNum(d.counts.funding, 0)} funding · ${d.counts.trades} trades · ${fmtNum(d.counts.equity, 0)} equity · ${d.counts.events} events`} />
          </div>
        </Panel>
      </div>

      <Panel title="Jobs" right={running ? <span className="text-sky-300">#{running.id} {running.kind} running</span> : `${d.jobs.length} recent`}>
        <div className="scroll-x">
          <table className="data">
            <thead><tr><th className="r">#</th><th>Kind</th><th>Status</th><th>Args</th><th>Created (UTC)</th><th>Started</th><th className="r">Duration</th><th>Result</th><th></th></tr></thead>
            <tbody>
              {d.jobs.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-zinc-500">No jobs yet</td></tr>}
              {d.jobs.map((j) => {
                const res = j.result as { backtestId?: number; backtestIds?: number[]; exitCode?: number | null } | null;
                return (
                  <tr key={j.id} className={viewJob === j.id ? "bg-zinc-800/40" : ""}>
                    <td className="r num text-zinc-500">{j.id}</td>
                    <td className="font-semibold">{j.kind}</td>
                    <td><span className={`chip ${STATUS_CLS[j.status] ?? ""}`}>{j.status === "running" && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />}{j.status}</span></td>
                    <td className="mono max-w-[22rem] truncate text-[11px] text-zinc-400" title={JSON.stringify(j.args)}>{argsText(j.args)}</td>
                    <td className="num text-zinc-400">{fmtTime(j.createdAt)}</td>
                    <td className="num text-zinc-400">{j.startedAt ? fmtTime(j.startedAt).slice(11) : "—"}</td>
                    <td className="r num text-zinc-400" suppressHydrationWarning>{j.durationMs !== null ? fmtUptime(j.durationMs) : "—"}</td>
                    <td>{res?.backtestId ? <Link href={`/backtests/${res.backtestId}?mode=${mode}`} className="text-amber-300 hover:underline">backtest #{res.backtestId}{res.backtestIds && res.backtestIds.length > 1 ? ` (+${res.backtestIds.length - 1})` : ""}</Link> : res?.exitCode !== undefined && res?.exitCode !== 0 && j.status === "failed" ? <span className="text-rose-300">exit {res.exitCode ?? "?"}</span> : <span className="text-zinc-600">—</span>}</td>
                    <td className="r">
                      <button className="btn btn-ghost btn-sm" onClick={() => setViewJob(viewJob === j.id ? null : j.id)}>{viewJob === j.id ? "hide log" : "log"}</button>
                      {(j.status === "running" || j.status === "queued") && <button className="btn btn-bad btn-sm ml-1" disabled={busy !== null} onClick={() => cancel(j.id)}>cancel</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title={viewJob !== null ? `Log · job #${viewJob}` : "Log · bot.log"} right={<span className="flex items-center gap-3">{viewJob !== null && <button className="btn btn-ghost btn-sm" onClick={() => setViewJob(null)}>show bot.log</button>}<label className="flex items-center gap-1"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow</label><span>{viewJob === null ? `${fmtBytes(d.log.size)} · tail 200` : "tail 400 · refreshes every 3 s"}</span></span>}>
        <div ref={logRef} className="scroll-y max-h-[28rem] overflow-y-auto bg-black/40 px-3 py-2" onScroll={(e) => { const el = e.currentTarget; setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 8); }}>
          <pre className="log">{viewJob !== null ? jobLog || "(no output yet)" : d.log.lines.length ? d.log.lines.join("\n") : "(bot.log is empty — start the bot)"}</pre>
        </div>
      </Panel>
    </div>
  );
}

function K({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-2 border-b border-zinc-800/60 py-0.5 last:border-0"><span className="text-zinc-500">{k}</span><span className="num text-right text-zinc-200">{v}</span></div>;
}
function argsText(a: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(a)) { if (k === "env" && v && typeof v === "object") parts.push(`env(${Object.keys(v as object).length})`); else parts.push(`${k}=${String(v)}`); }
  return parts.join(" ") || "—";
}
