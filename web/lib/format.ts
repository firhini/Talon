/** Deterministic formatters (UTC, fixed locale) so server and client render identical text. */

export function fmtNum(x: number | null | undefined, decimals = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const abs = Math.abs(x);
  const s = abs.toFixed(decimals);
  const [int, frac] = s.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (x < 0 ? "-" : "") + grouped + (frac !== undefined ? "." + frac : "");
}

export function fmtUsd(x: number | null | undefined, decimals = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return (x < 0 ? "-$" : "$") + fmtNum(Math.abs(x), decimals);
}

/** Signed USD, e.g. +$12.34 / -$5.00 */
export function fmtPnl(x: number | null | undefined, decimals = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return (x >= 0 ? "+$" : "-$") + fmtNum(Math.abs(x), decimals);
}

/** Fraction -> percent with sign, e.g. 0.0123 -> +1.23% */
export function fmtPct(frac: number | null | undefined, decimals = 2, sign = true): string {
  if (frac === null || frac === undefined || !Number.isFinite(frac)) return "—";
  const v = frac * 100;
  const s = v.toFixed(decimals) + "%";
  return sign && v > 0 ? "+" + s : s;
}

/** Price with adaptive precision (BTC vs HYPE vs sub-dollar coins). */
export function fmtPrice(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const a = Math.abs(x);
  const d = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : 5;
  return fmtNum(x, d);
}

export function fmtQty(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return String(Number(x.toFixed(6)));
}

export function fmtRatio(x: number | null | undefined, decimals = 2): string {
  if (x === null || x === undefined) return "—";
  if (x === Infinity) return "∞";
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(decimals);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 2025-03-01 14:35 (UTC) */
export function fmtTime(t: number | null | undefined, withSeconds = false): string {
  if (!t || !Number.isFinite(t)) return "—";
  const d = new Date(t);
  const base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return withSeconds ? `${base}:${pad(d.getUTCSeconds())}` : base;
}

export function fmtDate(t: number | null | undefined): string {
  if (!t || !Number.isFinite(t)) return "—";
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function fmtAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export function pnlClass(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x) || x === 0) return "text-zinc-300";
  return x > 0 ? "text-emerald-400" : "text-rose-400";
}
