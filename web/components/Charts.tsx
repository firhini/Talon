import type { MonteCarloResult } from "@talon/core";
import { fmtMult, fmtNum, fmtPct, fmtPnl, fmtUsd } from "@/lib/format";
import type { Agg, Bucket } from "@/lib/stats";

/** Hand-rolled SVG charts. No hooks, so they render on the server and inside client components alike. */

export interface Pt { t: number; v: number }
const SURFACE = "#111114", GRID = "#26262c", MUTED = "#8b8b95", GOOD = "#34d399", BAD = "#fb7185", ACCENT = "#f0b429", BLUE = "#3987e5";

export function Sparkline({ points, color = ACCENT, width = 120, height = 30, baseline, fill = true, pnl = false }: { points: Pt[]; color?: string; width?: number; height?: number; baseline?: number; fill?: boolean; pnl?: boolean }) {
  if (points.length < 2) return <svg width={width} height={height} className="block"><line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke={GRID} strokeDasharray="2 3" /></svg>;
  let min = Infinity, max = -Infinity;
  for (const p of points) { if (p.v < min) min = p.v; if (p.v > max) max = p.v; }
  if (baseline !== undefined) { min = Math.min(min, baseline); max = Math.max(max, baseline); }
  if (max === min) { max += 1; min -= 1; }
  const pad = 2, t0 = points[0].t, t1 = points[points.length - 1].t || t0 + 1;
  const x = (t: number) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (width - 2 * pad);
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (height - 2 * pad);
  const last = points[points.length - 1];
  const c = pnl ? (last.v >= (baseline ?? 0) ? GOOD : BAD) : color;
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const base = baseline !== undefined ? y(baseline) : height - pad;
  const area = `${d}L${x(last.t).toFixed(1)},${base.toFixed(1)}L${x(points[0].t).toFixed(1)},${base.toFixed(1)}Z`;
  return (
    <svg width={width} height={height} className="block overflow-visible" aria-hidden="true">
      {baseline !== undefined && <line x1={pad} x2={width - pad} y1={base} y2={base} stroke={GRID} strokeWidth={1} />}
      {fill && <path d={area} fill={c} opacity={0.12} />}
      <path d={d} fill="none" stroke={c} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.t)} cy={y(last.v)} r={2.5} fill={c} stroke={SURFACE} strokeWidth={1.5} />
    </svg>
  );
}

/** Tiny ± column strip (trade pnls, trades per day). */
export function BarStrip({ points, width = 120, height = 30, signed = true, color = BLUE }: { points: Pt[]; width?: number; height?: number; signed?: boolean; color?: string }) {
  if (!points.length) return <svg width={width} height={height} className="block" />;
  const max = Math.max(1e-9, ...points.map((p) => Math.abs(p.v)));
  const n = points.length, slot = width / n, bw = Math.max(1, Math.min(6, slot - 1));
  const mid = signed ? height / 2 : height;
  return (
    <svg width={width} height={height} className="block" aria-hidden="true">
      {signed && <line x1={0} x2={width} y1={mid} y2={mid} stroke={GRID} />}
      {points.map((p, i) => {
        const h = (Math.abs(p.v) / max) * (signed ? height / 2 - 1 : height - 1);
        const y = p.v >= 0 ? mid - h : mid;
        return <rect key={i} x={i * slot + (slot - bw) / 2} y={y} width={bw} height={Math.max(0.5, h)} fill={signed ? (p.v >= 0 ? GOOD : BAD) : color} rx={1} />;
      })}
    </svg>
  );
}

/** R-multiple histogram: columns from the baseline, colored by sign, labelled bin edges. */
export function Histogram({ bins, height = 150 }: { bins: Bucket[]; height?: number }) {
  const W = 420, padL = 8, padR = 8, padT = 14, padB = 22;
  const max = Math.max(1, ...bins.map((b) => b.n));
  const n = bins.length, slot = (W - padL - padR) / n, bw = Math.min(24, slot - 2);
  const ih = height - padT - padB;
  const lbl = (v: number) => (v === -Infinity ? "" : v === Infinity ? "" : v % 1 === 0 ? String(v) : v.toFixed(1));
  const total = bins.reduce((a, b) => a + b.n, 0);
  if (!total) return <Empty height={height} text="No closed trades yet" />;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="block h-auto w-full" preserveAspectRatio="none" role="img" aria-label="R-multiple histogram">
      <line x1={padL} x2={W - padR} y1={padT + ih} y2={padT + ih} stroke={GRID} />
      {bins.map((b, i) => {
        const h = (b.n / max) * ih, x = padL + i * slot + (slot - bw) / 2;
        const neg = b.to <= 0;
        return (
          <g key={i}>
            <title>{`${b.from === -Infinity ? "<" : b.from}${b.from === -Infinity ? "" : " to "}${b.to === Infinity ? "+" : b.to}R: ${b.n} trades, ${fmtPnl(b.pnl)}`}</title>
            <rect x={x} y={padT + ih - h} width={bw} height={h} fill={neg ? BAD : GOOD} rx={h > 4 ? 3 : 0} />
            {b.n > 0 && <text x={x + bw / 2} y={padT + ih - h - 3} textAnchor="middle" fontSize={9} fill={MUTED}>{b.n}</text>}
            {i > 0 && <text x={padL + i * slot} y={height - 8} textAnchor="middle" fontSize={9} fill={MUTED}>{lbl(b.from)}</text>}
          </g>
        );
      })}
      <line x1={padL + bins.findIndex((b) => b.from === 0) * slot} x2={padL + bins.findIndex((b) => b.from === 0) * slot} y1={padT} y2={padT + ih} stroke="#52525b" strokeDasharray="3 3" />
    </svg>
  );
}

/** Horizontal bars from a zero baseline (pnl per coin / per exit reason). */
export function HBars({ rows, getValue = (r) => r.pnl, labelOf = (r) => r.key, format = (v) => fmtPnl(v), height }: { rows: Agg[]; getValue?: (r: Agg) => number; labelOf?: (r: Agg) => string; format?: (v: number) => string; height?: number }) {
  if (!rows.length) return <Empty height={height ?? 120} text="No data" />;
  const W = 420, rowH = 22, padL = 52, padR = 70, H = height ?? rows.length * rowH + 10;
  const vals = rows.map(getValue);
  const maxAbs = Math.max(1e-9, ...vals.map(Math.abs));
  const hasNeg = vals.some((v) => v < 0), hasPos = vals.some((v) => v > 0);
  const iw = W - padL - padR;
  const zero = hasNeg && hasPos ? padL + iw / 2 : hasNeg ? padL + iw : padL;
  const scale = hasNeg && hasPos ? iw / 2 / maxAbs : iw / maxAbs;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="bars">
      <line x1={zero} x2={zero} y1={4} y2={H - 4} stroke={GRID} />
      {rows.map((r, i) => {
        const v = getValue(r), w = Math.abs(v) * scale, y = 5 + i * rowH, x = v >= 0 ? zero : zero - w;
        return (
          <g key={r.key}>
            <title>{`${labelOf(r)}: ${format(v)} · ${r.n} trades · ${r.n ? Math.round((r.wins / r.n) * 100) : 0}% win`}</title>
            <text x={padL - 8} y={y + 13} textAnchor="end" fontSize={11} fill="#d4d4d8" fontWeight={600}>{labelOf(r)}</text>
            <rect x={x} y={y + 2} width={Math.max(1, w)} height={rowH - 6} fill={v >= 0 ? GOOD : BAD} rx={3} />
            <text x={v >= 0 ? zero + w + 6 : zero - w - 6} y={y + 13} textAnchor={v >= 0 ? "start" : "end"} fontSize={10} fill={MUTED} className="num">{format(v)} <tspan fill="#52525b">· {r.n}</tspan></text>
          </g>
        );
      })}
    </svg>
  );
}

const DONUT_COLORS = [BLUE, "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9", "#e66767", "#71717a"];
export function Donut({ rows, size = 120 }: { rows: Agg[]; size?: number }) {
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (!total) return <Empty height={size} text="No exits yet" />;
  const R = size / 2 - 4, r = R * 0.62, cx = size / 2, cy = size / 2;
  let a0 = -Math.PI / 2;
  const arcs = rows.slice(0, 8).map((row, i) => {
    const frac = row.n / total, a1 = a0 + frac * 2 * Math.PI;
    const p = (ang: number, rad: number) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
    const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R), [x2, y2] = p(a1, r), [x3, y3] = p(a0, r);
    const large = frac > 0.5 ? 1 : 0;
    const d = frac >= 0.9999 ? `M${cx + R},${cy}A${R},${R} 0 1 1 ${cx - R},${cy}A${R},${R} 0 1 1 ${cx + R},${cy}M${cx + r},${cy}A${r},${r} 0 1 0 ${cx - r},${cy}A${r},${r} 0 1 0 ${cx + r},${cy}` : `M${x0},${y0}A${R},${R} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${r},${r} 0 ${large} 0 ${x3},${y3}Z`;
    a0 = a1;
    return { d, color: DONUT_COLORS[i % DONUT_COLORS.length], row, frac };
  });
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} className="shrink-0" role="img" aria-label="exit reasons">
        {arcs.map((a, i) => <path key={i} d={a.d} fill={a.color} stroke={SURFACE} strokeWidth={2} fillRule="evenodd"><title>{`${a.row.key}: ${a.row.n} (${Math.round(a.frac * 100)}%) · ${fmtPnl(a.row.pnl)}`}</title></path>)}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize={16} fontWeight={700} fill="#e7e7ea">{total}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize={9} fill={MUTED}>exits</text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1 text-xs">
        {arcs.map((a, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: a.color }} />
            <span className="truncate text-zinc-300">{a.row.key}</span>
            <span className="num ml-auto text-zinc-500">{a.row.n} · {Math.round(a.frac * 100)}%</span>
            <span className={`num w-16 text-right ${a.row.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtPnl(a.row.pnl, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Year × month calendar grid, diverging emerald/rose by pnl, neutral for no trades. */
export function MonthHeatmap({ monthly, pct = false, base }: { monthly: Agg[]; pct?: boolean; base?: number }) {
  if (!monthly.length) return <Empty height={90} text="No closed trades yet" />;
  const years = [...new Set(monthly.map((m) => m.key.slice(0, 4)))].sort();
  const byKey = new Map(monthly.map((m) => [m.key, m]));
  const maxAbs = Math.max(1e-9, ...monthly.map((m) => Math.abs(m.pnl)));
  const cell = 34, gap = 2, padL = 36, padT = 16;
  const W = padL + 12 * (cell + gap), H = padT + years.length * (cell + gap);
  const shade = (v: number) => { const a = 0.15 + 0.75 * Math.min(1, Math.abs(v) / maxAbs); return v >= 0 ? `rgba(52,211,153,${a})` : `rgba(251,113,133,${a})`; };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full max-w-[560px]" role="img" aria-label="monthly pnl">
      {MONTHS.map((m, i) => <text key={m} x={padL + i * (cell + gap) + cell / 2} y={10} textAnchor="middle" fontSize={9} fill={MUTED}>{m}</text>)}
      {years.map((y, yi) => (
        <g key={y}>
          <text x={padL - 6} y={padT + yi * (cell + gap) + cell / 2 + 3} textAnchor="end" fontSize={10} fill={MUTED}>{y}</text>
          {MONTHS.map((_, mi) => {
            const k = `${y}-${String(mi + 1).padStart(2, "0")}`, m = byKey.get(k);
            const x = padL + mi * (cell + gap), yy = padT + yi * (cell + gap);
            const txt = m ? (pct && base ? fmtPct(m.pnl / base, 0) : fmtPnl(m.pnl, 0)) : "";
            return (
              <g key={k}>
                <title>{m ? `${k}: ${fmtPnl(m.pnl)} · ${m.n} trades · ${Math.round((m.wins / m.n) * 100)}% win` : `${k}: no trades`}</title>
                <rect x={x} y={yy} width={cell} height={cell} rx={3} fill={m ? shade(m.pnl) : "#18181c"} stroke={m ? "none" : "#1f1f25"} />
                {m && <text x={x + cell / 2} y={yy + cell / 2 + 3} textAnchor="middle" fontSize={8.5} fill="#f4f4f5" className="num">{txt.replace("$", "")}</text>}
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}

/** Monte-Carlo outcome strip on a log axis: p5–p95 whisker, p25–p75 band, median marker, ×1 reference. */
export function McStrip({ mc }: { mc: MonteCarloResult }) {
  const W = 420, H = 64, padL = 10, padR = 10;
  const lo = Math.min(mc.p5, 1) / 1.6, hi = Math.max(mc.p95, 1) * 1.6;
  const lg = (v: number) => Math.log10(Math.max(1e-4, v));
  const x = (v: number) => padL + ((lg(v) - lg(lo)) / (lg(hi) - lg(lo))) * (W - padL - padR);
  const y = 26;
  const ticks = [0.01, 0.1, 0.5, 1, 2, 5, 10, 50, 100, 1000].filter((t) => t >= lo && t <= hi);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Monte-Carlo outcome distribution">
      <line x1={padL} x2={W - padR} y1={y} y2={y} stroke={GRID} />
      {ticks.map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={y - 3} y2={y + 3} stroke="#3f3f46" /><text x={x(t)} y={H - 4} textAnchor="middle" fontSize={9} fill={MUTED}>{fmtMult(t)}</text></g>)}
      <line x1={x(1)} x2={x(1)} y1={6} y2={y + 8} stroke="#a1a1aa" strokeDasharray="3 2" />
      <line x1={x(mc.p5)} x2={x(mc.p95)} y1={y} y2={y} stroke={BLUE} strokeWidth={2} strokeLinecap="round"><title>{`5th–95th percentile: ${fmtMult(mc.p5)} – ${fmtMult(mc.p95)}`}</title></line>
      <rect x={x(mc.p25)} y={y - 7} width={Math.max(2, x(mc.p75) - x(mc.p25))} height={14} rx={3} fill={BLUE} opacity={0.85}><title>{`25th–75th percentile: ${fmtMult(mc.p25)} – ${fmtMult(mc.p75)}`}</title></rect>
      <circle cx={x(mc.p50)} cy={y} r={5} fill={ACCENT} stroke={SURFACE} strokeWidth={2}><title>{`median ${fmtMult(mc.p50)}`}</title></circle>
      <text x={x(mc.p50)} y={12} textAnchor="middle" fontSize={10} fill="#e7e7ea" fontWeight={600}>median {fmtMult(mc.p50)}</text>
      <text x={x(mc.p5)} y={y + 20} textAnchor="middle" fontSize={9} fill={MUTED}>p5 {fmtMult(mc.p5)}</text>
      <text x={x(mc.p95)} y={y + 20} textAnchor="middle" fontSize={9} fill={MUTED}>p95 {fmtMult(mc.p95)}</text>
    </svg>
  );
}

/** 1–5 risk meter: emerald → amber → red. */
export function RiskMeter({ level, size = "md" }: { level: number; size?: "sm" | "md" }) {
  const colors = ["#34d399", "#a3e635", "#fbbf24", "#f97316", "#ef4444"];
  const h = size === "sm" ? "h-1.5 w-3" : "h-2 w-5";
  return (
    <span className="inline-flex items-center gap-0.5" title={`risk level ${level}/5`} aria-label={`risk level ${level} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={`${h} rounded-sm`} style={{ background: i <= level ? colors[level - 1] : "#26262c" }} />)}
    </span>
  );
}

/** Horizontal progress bar with a danger threshold (drawdown vs kill switch, daily loss vs limit). */
export function Meter({ value, max, danger = 0.7, label }: { value: number; max: number; danger?: number; label?: string }) {
  const f = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const color = f >= danger ? BAD : f >= danger * 0.6 ? ACCENT : GOOD;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800" title={label}>
      <div className="h-full rounded-full transition-[width]" style={{ width: `${f * 100}%`, background: color }} />
    </div>
  );
}

export function Empty({ height, text }: { height: number; text: string }) {
  return <div className="flex items-center justify-center text-xs text-zinc-600" style={{ height }}>{text}</div>;
}

export const chartFmt = { usd: fmtUsd, num: fmtNum };
