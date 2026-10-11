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

/** Compact magnitude: 843M / 12.9K / 1.23 (USD when `usd`). */
export function fmtCompact(x: number | null | undefined, usd = false): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const a = Math.abs(x), s = x < 0 ? "-" : "", p = usd ? "$" : "";
  if (a >= 1e9) return `${s}${p}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${p}${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e4) return `${s}${p}${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return `${s}${p}${fmtNum(a, a >= 100 ? 0 : 2)}`;
}

/** Equity multiple, e.g. ×3.1 / ×0.42 / ×120 */
export function fmtMult(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return "×" + (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
}

/** 1h 23m / 2d 4h for uptimes */
export function fmtUptime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
