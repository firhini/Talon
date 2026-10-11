"use client";
import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import type { EffectiveEntry } from "@/lib/effective";
import type { SettingsPayload } from "@/lib/payloads";
import LiveDialog from "./LiveDialog";
import { Panel } from "./Panels";

type Checklist = { keySet: boolean; addressSet: boolean; maxEquitySet: boolean; testnet: boolean; maxEquity: number | null; address: string | null; ready: boolean; problems: string[] };
const SOURCE_CLS: Record<string, string> = { settings: "border-sky-500/40 text-sky-300", override: "border-amber-500/40 text-amber-300", preset: "border-emerald-500/40 text-emerald-300", ".env": "border-zinc-600 text-zinc-300", default: "border-zinc-800 text-zinc-500" };

export default function SettingsForm({ initial, checklist, mode }: { initial: SettingsPayload; checklist: Checklist; mode: string }) {
  const [d, setD] = useState(initial);
  const [check, setCheck] = useState(checklist);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [key, setKey] = useState("");
  const [liveOpen, setLiveOpen] = useState(false);

  const byKey = useMemo(() => new Map(d.effective.map((e) => [e.key, e])), [d.effective]);
  const groups = useMemo(() => { const g = new Map<string, typeof d.editable>(); for (const e of d.editable) g.set(e.group, [...(g.get(e.group) ?? []), e]); return [...g.entries()]; }, [d.editable]);
  const current = (k: string) => draft[k] ?? d.settings[k] ?? "";
  const dirty = Object.keys(draft).filter((k) => draft[k] !== (d.settings[k] ?? ""));

  async function reload() {
    try { const s = await api<SettingsPayload>("/api/settings"); setD(s); const l = await api<{ checklist: Checklist }>("/api/live"); setCheck(l.checklist); } catch { /* ignore */ }
  }
  async function save() {
    setBusy("save"); setMsg(null);
    try {
      const values: Record<string, string | null> = {};
      for (const k of dirty) values[k] = draft[k] === "" ? null : draft[k];
      const r = await api<SettingsPayload & { restartNeeded: boolean }>("/api/settings", { values }, "PUT");
      setD(r); setDraft({}); setRestartNeeded(r.restartNeeded); setMsg(`Saved ${dirty.length} setting${dirty.length > 1 ? "s" : ""}`);
      void reload();
    } catch (e) { setMsg(`Error: ${(e as Error).message}`); } finally { setBusy(null); }
  }
  async function saveKey(clear = false) {
    setBusy("key"); setMsg(null);
    try {
      const r = await api<{ secrets: Record<string, boolean>; restartNeeded: boolean }>("/api/secrets", { key: "HL_PRIVATE_KEY", value: clear ? null : key.trim() });
      setD({ ...d, secrets: r.secrets }); setKey(""); setMsg(clear ? "Private key removed from .env" : "Private key written to .env (never shown again)");
      if (r.restartNeeded) setRestartNeeded(true);
      void reload();
    } catch (e) { setMsg(`Error: ${(e as Error).message}`); } finally { setBusy(null); }
  }
  async function restart() {
    setBusy("restart"); setMsg(null);
    try { await api("/api/process", { action: "restart" }); setRestartNeeded(false); setMsg("Bot restarted with the new settings"); void reload(); }
    catch (e) { setMsg(`Error: ${(e as Error).message}`); } finally { setBusy(null); }
  }
  async function backToPaper() {
    setBusy("paper"); setMsg(null);
    try { await api("/api/live", { action: "back-to-paper" }); setMsg("Back to paper: MODE=paper, paper bot running"); void reload(); }
    catch (e) { setMsg(`Error: ${(e as Error).message}`); } finally { setBusy(null); }
  }

  const liveGroup = groups.filter(([g]) => g === "Live"), otherGroups = groups.filter(([g]) => g !== "Live");
  return (
    <div className="space-y-4">
      {(restartNeeded || (d.botRunning && dirty.length > 0)) && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-sky-600/50 bg-sky-950/30 px-4 py-2 text-sm text-sky-200">
          <span>The bot is running in <b>{d.botMode}</b> mode — saved settings take effect after a restart.</span>
          {d.botMode === "paper" && restartNeeded && <button className="btn btn-default btn-sm" disabled={busy !== null} onClick={() => void restart()}>↻ Restart bot now</button>}
          {d.botMode === "live" && restartNeeded && <span className="text-xs text-zinc-400">(live bot: stop it and go live again from the command center)</span>}
        </div>
      )}
      {msg && <div role="status" className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs text-zinc-200">{msg}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-zinc-400">Every row shows the <b className="text-zinc-200">effective value</b> the bot gets and where it comes from: <Src s="settings" /> saved here, <Src s="preset" /> from the active preset{d.preset ? ` (${d.preset.name})` : ""}, <Src s="override" /> saved here on top of the preset, <Src s=".env" /> from the .env file, <Src s="default" /> documented default.</p>
        <div className="ml-auto flex items-center gap-2">
          <button className="btn btn-warn" disabled={busy !== null || dirty.length === 0} onClick={() => void save()}>{busy === "save" ? "Saving…" : `Save${dirty.length ? ` ${dirty.length}` : ""}`}</button>
          <button className="btn btn-ghost" disabled={dirty.length === 0} onClick={() => setDraft({})}>Discard</button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {otherGroups.map(([group, fields]) => (
          <Panel key={group} title={group}>
            <table className="data">
              <thead><tr><th className="w-44">Setting</th><th className="min-w-[9rem]">Value</th><th>Effective</th><th>Source</th><th>Help</th></tr></thead>
              <tbody>
                {fields.map((f) => {
                  const e = byKey.get(f.key);
                  const v = current(f.key);
                  const changed = draft[f.key] !== undefined && draft[f.key] !== (d.settings[f.key] ?? "");
                  return (
                    <tr key={f.key} className={changed ? "bg-amber-500/5" : ""}>
                      <td><div className="text-zinc-200">{f.label}</div><div className="mono text-[10px] text-zinc-600">{f.key}</div></td>
                      <td>
                        {f.type === "select" ? (
                          <select className="input" value={v} onChange={(ev) => setDraft({ ...draft, [f.key]: ev.target.value })}><option value="">(inherit)</option>{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
                        ) : f.type === "boolean" ? (
                          <select className="input" value={v} onChange={(ev) => setDraft({ ...draft, [f.key]: ev.target.value })}><option value="">(inherit)</option><option value="true">true</option><option value="false">false</option></select>
                        ) : (
                          <input className="input mono" type={f.type === "number" ? "number" : "text"} step="any" value={v} placeholder={e?.value ?? ""} onChange={(ev) => setDraft({ ...draft, [f.key]: ev.target.value })} />
                        )}
                      </td>
                      <td className="num text-zinc-200">{e?.value || <span className="text-zinc-600">—</span>}</td>
                      <td>{e && <Src s={e.source} />}</td>
                      <td className="max-w-[14rem] truncate text-zinc-500" title={f.help}>{f.help}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        ))}

        <Panel title="Secrets — stored only in .env" right={<span className="mono">{d.envFile}</span>}>
          <div className="space-y-3 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-zinc-300">HL_PRIVATE_KEY</span>
              {d.secrets.HL_PRIVATE_KEY ? <span className="chip border-emerald-500/40 bg-emerald-500/10 text-emerald-300">set ✓</span> : <span className="chip border-rose-500/40 bg-rose-500/10 text-rose-300">not set</span>}
              <span className="text-xs text-zinc-500">API (agent) wallet key with trading-only permission — never your main wallet key. Write-only: the dashboard never displays it.</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input className="input mono max-w-xl" type="password" autoComplete="off" spellCheck={false} placeholder="0x… (64 hex characters)" value={key} onChange={(e) => setKey(e.target.value)} />
              <button className="btn btn-warn" disabled={busy !== null || !/^0x[0-9a-fA-F]{64}$/.test(key.trim())} onClick={() => void saveKey()}>Save key</button>
              {d.secrets.HL_PRIVATE_KEY && <button className="btn btn-ghost" disabled={busy !== null} onClick={() => void saveKey(true)}>Remove</button>}
            </div>
            <p className="text-xs text-zinc-500">How to create one: Hyperliquid app → More → API → Generate → Authorize API Wallet; copy the key shown once. Keys expire (max 180 days).</p>
          </div>
        </Panel>

        {liveGroup.map(([group, fields]) => (
          <Panel key={group} title="Live trading" right={d.mode === "live" ? <span className="text-red-400">MODE=live</span> : <span>MODE=paper</span>}>
            <table className="data">
              <thead><tr><th className="w-44">Setting</th><th className="min-w-[9rem]">Value</th><th>Effective</th><th>Source</th></tr></thead>
              <tbody>
                {fields.map((f) => {
                  const e = byKey.get(f.key), v = current(f.key);
                  return (
                    <tr key={f.key}>
                      <td><div className="text-zinc-200">{f.label}</div><div className="mono text-[10px] text-zinc-600">{f.key}</div></td>
                      <td>{f.type === "boolean" ? <select className="input" value={v} onChange={(ev) => setDraft({ ...draft, [f.key]: ev.target.value })}><option value="">(inherit)</option><option value="true">true</option><option value="false">false</option></select> : <input className="input mono" type={f.type === "number" ? "number" : "text"} step="any" value={v} placeholder={e?.value ?? ""} onChange={(ev) => setDraft({ ...draft, [f.key]: ev.target.value })} />}</td>
                      <td className="num text-zinc-200">{f.key === "HL_ACCOUNT_ADDRESS" && e?.value ? `${e.value.slice(0, 8)}…${e.value.slice(-6)}` : e?.value || <span className="text-zinc-600">—</span>}</td>
                      <td>{e && <Src s={e.source} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="border-t border-zinc-800 px-4 py-3">
              <div className="mb-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Go-live checklist</div>
              <ul className="grid gap-1 text-sm sm:grid-cols-2">
                <Check ok={check.keySet} label="Private key set in .env" />
                <Check ok={check.addressSet} label={`Account address ${check.address ? `${check.address.slice(0, 6)}…${check.address.slice(-4)}` : "missing"}`} />
                <Check ok={check.maxEquitySet} label={`Max account equity ${check.maxEquity !== null ? `${check.maxEquity} USDC` : "missing"}`} />
                <Check ok={true} label={check.testnet ? "Testnet (HL_TESTNET=true)" : "Mainnet — real funds"} warn={!check.testnet} />
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button className="btn btn-live" disabled={busy !== null || !check.ready || (d.botRunning && d.botMode === "live")} onClick={() => setLiveOpen(true)}>{d.botRunning && d.botMode === "live" ? "LIVE bot running" : "Go live…"}</button>
                <button className="btn btn-default" disabled={busy !== null || (!d.botRunning && d.mode === "paper")} onClick={() => void backToPaper()}>← Back to paper</button>
                {d.botRunning && <span className="text-xs text-zinc-500">bot process running in {d.botMode} mode{d.botMode === "paper" ? " — going live stops it first" : ""}</span>}
              </div>
            </div>
          </Panel>
        ))}
      </div>
      <LiveDialog open={liveOpen} onClose={() => setLiveOpen(false)} onStarted={() => { setMsg("LIVE bot started"); window.location.href = `/?mode=live`; }} />
      {mode === "live" && <p className="text-xs text-zinc-600">Viewing the live dashboard mode.</p>}
    </div>
  );
}

function Src({ s }: { s: EffectiveEntry["source"] | string }) {
  return <span className={`chip ${SOURCE_CLS[s] ?? SOURCE_CLS.default}`}>{s}</span>;
}
function Check({ ok, label, warn = false }: { ok: boolean; label: string; warn?: boolean }) {
  return <li className="flex items-center gap-2"><span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${ok ? (warn ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-300") : "bg-rose-500/20 text-rose-300"}`}>{ok ? (warn ? "!" : "✓") : "✕"}</span><span className={ok ? "text-zinc-200" : "text-zinc-400"}>{label}</span></li>;
}
