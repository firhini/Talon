import type { Trade } from "@talon/core";

/** Pure trade-log statistics shared by the command center (paper/live trades) and the backtest pages. */

export interface Bucket { from: number; to: number; n: number; pnl: number }
export interface Agg { key: string; n: number; wins: number; pnl: number }
export interface TradeStats {
  n: number; wins: number; losses: number; winRate: number;
  /** null = no losses (infinite) */
  profitFactor: number | null;
  expectancy: number; expectancyR: number; avgWin: number; avgLoss: number;
  gross: number; fees: number; funding: number; net: number;
  best: { pnl: number; coin: string; roe: number; exitTime: number } | null;
  worst: { pnl: number; coin: string; roe: number; exitTime: number } | null;
  streak: { kind: "win" | "loss" | "none"; n: number };
  longestWinStreak: number; longestLossStreak: number;
  tradesToday: number; pnlToday: number; longs: number; shorts: number; avgHoldHours: number;
  rHistogram: Bucket[];
  /** YYYY-MM buckets by exit time */
  monthly: Agg[];
  perCoin: Agg[];
  exitReasons: Agg[];
  /** cumulative net pnl after each trade, oldest first */
  cumulative: { t: number; v: number }[];
  /** last 40 trade pnls, oldest first (streak strip) */
  recent: { t: number; v: number }[];
  /** rolling 20-trade win rate, oldest first */
  rollingWinRate: { t: number; v: number }[];
  /** trades per UTC day for the last 14 days, oldest first */
  perDay: { t: number; v: number }[];
}

export const R_BINS: [number, number][] = [[-Infinity, -2], [-2, -1.5], [-1.5, -1], [-1, -0.5], [-0.5, 0], [0, 0.5], [0.5, 1], [1, 1.5], [1.5, 2], [2, 3], [3, 4], [4, Infinity]];

export function rMultiple(t: Trade): number | null {
  const r = Math.abs(t.entryPrice - t.stopPrice) * t.qty;
  return r > 0 ? t.pnl / r : null;
}
export function exitKey(reason: string): string {
  return reason.replace(/:.*$/, "").replace(/ \(.*\)$/, "").trim() || "other";
}
export function ym(t: number): string {
  return new Date(t).toISOString().slice(0, 7);
}

export function tradeStats(input: Trade[], now = Date.now()): TradeStats {
  const trades = [...input].sort((a, b) => a.exitTime - b.exitTime);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = sum(wins.map((t) => t.pnl)), grossLoss = -sum(losses.map((t) => t.pnl));
  const rs = trades.map(rMultiple).filter((r): r is number => r !== null);
  const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
  const today = trades.filter((t) => t.exitTime >= dayStart);
  let streak: TradeStats["streak"] = { kind: "none", n: 0 };
  for (let i = trades.length - 1; i >= 0; i--) {
    const kind = trades[i].pnl > 0 ? "win" : "loss";
    if (streak.kind === "none") streak = { kind, n: 1 };
    else if (streak.kind === kind) streak.n++;
    else break;
  }
  let lw = 0, ll = 0, cw = 0, cl = 0;
  for (const t of trades) { if (t.pnl > 0) { cw++; cl = 0; } else { cl++; cw = 0; } lw = Math.max(lw, cw); ll = Math.max(ll, cl); }
  const agg = (key: (t: Trade) => string): Agg[] => {
    const m = new Map<string, Agg>();
    for (const t of trades) { const k = key(t); const e = m.get(k) ?? { key: k, n: 0, wins: 0, pnl: 0 }; e.n++; e.pnl += t.pnl; if (t.pnl > 0) e.wins++; m.set(k, e); }
    return [...m.values()];
  };
  const rHistogram: Bucket[] = R_BINS.map(([from, to]) => ({ from, to, n: 0, pnl: 0 }));
  trades.forEach((t) => { const r = rMultiple(t); if (r === null) return; const b = rHistogram.find((x) => r >= x.from && r < x.to) ?? rHistogram[rHistogram.length - 1]; b.n++; b.pnl += t.pnl; });
  const cumulative: { t: number; v: number }[] = [];
  let acc = 0;
  for (const t of trades) { acc += t.pnl; cumulative.push({ t: t.exitTime, v: acc }); }
  const rollingWinRate: { t: number; v: number }[] = [];
  for (let i = 0; i < trades.length; i++) { const w = trades.slice(Math.max(0, i - 19), i + 1); rollingWinRate.push({ t: trades[i].exitTime, v: w.filter((t) => t.pnl > 0).length / w.length }); }
  const perDay: { t: number; v: number }[] = [];
  for (let d = 13; d >= 0; d--) { const t0 = dayStart - d * 86_400_000; perDay.push({ t: t0, v: trades.filter((t) => t.exitTime >= t0 && t.exitTime < t0 + 86_400_000).length }); }
  const by = (t: Trade) => ({ pnl: t.pnl, coin: t.coin, roe: t.roe, exitTime: t.exitTime });
  return {
    n: trades.length, wins: wins.length, losses: losses.length, winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : 0,
    expectancy: trades.length ? sum(trades.map((t) => t.pnl)) / trades.length : 0,
    expectancyR: rs.length ? sum(rs) / rs.length : 0,
    avgWin: wins.length ? grossWin / wins.length : 0, avgLoss: losses.length ? grossLoss / losses.length : 0,
    gross: sum(trades.map((t) => t.grossPnl)), fees: sum(trades.map((t) => t.fees)), funding: sum(trades.map((t) => t.funding)), net: sum(trades.map((t) => t.pnl)),
    best: trades.length ? by(trades.reduce((a, b) => (b.pnl > a.pnl ? b : a))) : null,
    worst: trades.length ? by(trades.reduce((a, b) => (b.pnl < a.pnl ? b : a))) : null,
    streak, longestWinStreak: lw, longestLossStreak: ll,
    tradesToday: today.length, pnlToday: sum(today.map((t) => t.pnl)),
    longs: trades.filter((t) => t.side === "long").length, shorts: trades.filter((t) => t.side === "short").length,
    avgHoldHours: trades.length ? sum(trades.map((t) => (t.exitTime - t.entryTime) / 3_600_000)) / trades.length : 0,
    rHistogram, monthly: agg((t) => ym(t.exitTime)).sort((a, b) => a.key.localeCompare(b.key)),
    perCoin: agg((t) => t.coin).sort((a, b) => b.pnl - a.pnl), exitReasons: agg((t) => exitKey(t.reasonExit)).sort((a, b) => b.n - a.n),
    cumulative, recent: trades.slice(-40).map((t) => ({ t: t.exitTime, v: t.pnl })), rollingWinRate: rollingWinRate.slice(-60), perDay,
  };
}

/** Drawdown from running peak as a negative fraction, aligned to the input points. */
export function drawdownSeries(points: { t: number; v: number }[]): { t: number; v: number }[] {
  let peak = -Infinity;
  return points.map((p) => { if (p.v > peak) peak = p.v; return { t: p.t, v: peak > 0 ? -(peak - p.v) / peak : 0 }; });
}

/** Keep at most `max` points (evenly thinned, last point always kept). */
export function thin<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  out.push(arr[arr.length - 1]);
  return out;
}
