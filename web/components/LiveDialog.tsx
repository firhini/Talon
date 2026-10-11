"use client";
import { useEffect, useState } from "react";

interface Checklist { keySet: boolean; addressSet: boolean; maxEquitySet: boolean; testnet: boolean; maxEquity: number | null; address: string | null; ready: boolean; problems: string[] }

/**
 * Go-live dialog: shows the checklist, makes the user type LIVE, fetches a one-time token and starts the bot in live
 * mode. The private key never passes through here; only "set / not set".
 */
export default function LiveDialog({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted?: () => void }) {
  const [check, setCheck] = useState<Checklist | null>(null);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhrase(""); setErr(null);
    fetch("/api/live", { cache: "no-store" }).then((r) => r.json()).then((b: { checklist?: Checklist }) => setCheck(b.checklist ?? null)).catch(() => setCheck(null));
  }, [open]);

  if (!open) return null;

  async function go() {
    setBusy(true); setErr(null);
    try {
      const c = await fetch("/api/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "confirm", phrase }) });
      const cb = (await c.json()) as { ok: boolean; token?: string; error?: string };
      if (!c.ok || !cb.ok || !cb.token) throw new Error(cb.error ?? `HTTP ${c.status}`);
      const s = await fetch("/api/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start", token: cb.token }) });
      const sb = (await s.json()) as { ok: boolean; error?: string };
      if (!s.ok || !sb.ok) throw new Error(sb.error ?? `HTTP ${s.status}`);
      onStarted?.();
      onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const Row = ({ ok, label }: { ok: boolean; label: string }) => (
    <li className="flex items-center gap-2 text-sm"><span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${ok ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>{ok ? "✓" : "✕"}</span><span className={ok ? "text-zinc-200" : "text-zinc-400"}>{label}</span></li>
  );

  return (
    <div className="backdrop" role="dialog" aria-modal="true" aria-labelledby="live-title" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal p-5">
        <div className="flex items-center gap-3">
          <span className="pulse-live rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold tracking-widest text-white">LIVE</span>
          <h2 id="live-title" className="text-lg font-semibold">Start trading with real money</h2>
        </div>
        <p className="mt-2 text-sm text-zinc-400">The bot will place real orders on Hyperliquid{check?.testnet ? " TESTNET" : ""} with the active preset. The account is capped by MAX_ACCOUNT_EQUITY; every position carries an exchange stop. You can lose the money in the account.</p>
        <ul className="mt-4 space-y-1.5 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
          {check ? (
            <>
              <Row ok={check.keySet} label="HL_PRIVATE_KEY set in .env (API wallet, trading-only)" />
              <Row ok={check.addressSet} label={`HL_ACCOUNT_ADDRESS ${check.address ? `${check.address.slice(0, 6)}…${check.address.slice(-4)}` : "not set"}`} />
              <Row ok={check.maxEquitySet} label={`MAX_ACCOUNT_EQUITY ${check.maxEquity !== null ? `${check.maxEquity} USDC` : "not set"}`} />
              <Row ok={true} label={check.testnet ? "HL_TESTNET=true — testnet, no real funds" : "Mainnet — real funds"} />
            </>
          ) : <li className="text-sm text-zinc-500">checking…</li>}
        </ul>
        {check && !check.ready && <p className="mt-3 text-xs text-rose-300">Fix the items above in Settings before going live.</p>}
        <label className="mt-4 block text-xs text-zinc-400">Type <span className="kbd">LIVE</span> to confirm
          <input className="input mono mt-1" value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="LIVE" autoFocus spellCheck={false} disabled={busy || !check?.ready} onKeyDown={(e) => { if (e.key === "Enter" && phrase === "LIVE") void go(); }} />
        </label>
        {err && <p className="mt-2 text-xs text-rose-300">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-default" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-live" disabled={busy || phrase !== "LIVE" || !check?.ready} onClick={() => void go()}>{busy ? "Starting…" : "Start LIVE bot"}</button>
        </div>
      </div>
    </div>
  );
}

/** Generic confirm dialog (kill switch, risky preset activation, delete). */
export function ConfirmDialog({ open, title, body, confirmLabel = "Confirm", danger = false, onConfirm, onClose, busy = false }: { open: boolean; title: string; body: React.ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void; busy?: boolean }) {
  if (!open) return null;
  return (
    <div className="backdrop" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal p-5">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="mt-2 text-sm text-zinc-400">{body}</div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-default" onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`btn ${danger ? "btn-bad" : "btn-warn"}`} onClick={onConfirm} disabled={busy}>{busy ? "…" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
