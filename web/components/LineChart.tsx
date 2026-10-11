"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fmtTime, fmtUsd } from "@/lib/format";

export interface Series { name: string; color: string; points: { t: number; v: number }[]; dashed?: boolean }
interface Props {
  series: Series[];
  height?: number;
  /** serializable so server components can pass it */
  yFormat?: "usd" | "int";
  /** horizontal reference line (e.g. start equity) */
  baseline?: number;
  /** vertical marker (e.g. kill switch time) */
  markerT?: number | null;
  markerLabel?: string;
  emptyText?: string;
}

const PAD = { l: 56, r: 12, t: 12, b: 24 };

function niceTicks(min: number, max: number, n = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / n, mag = 10 ** Math.floor(Math.log10(raw)), norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const TIME_STEPS = [MIN, 2 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY];

/** Ticks on round time boundaries (minutes / hours / days) with at most ~n ticks. */
function timeTicks(min: number, max: number, n: number): number[] {
  const span = Math.max(1, max - min);
  const last = TIME_STEPS[TIME_STEPS.length - 1];
  const step = TIME_STEPS.find((s) => span / s <= n) ?? last * Math.ceil(span / (last * n));
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) out.push(t);
  return out;
}

/** Label by span: time of day for intraday sessions, date+time for a couple of weeks, date only beyond. */
function timeLabel(span: number): (t: number) => string {
  if (span < 2 * DAY) return (t) => fmtTime(t).slice(11);
  if (span < 14 * DAY) return (t) => fmtTime(t).slice(5);
  return (t) => fmtTime(t).slice(0, 10);
}

export default function LineChart({ series, height = 260, yFormat = "int", baseline, markerT, markerLabel, emptyText = "No data yet" }: Props) {
  const fmtY = yFormat === "usd" ? (v: number) => fmtUsd(v, 0) : (v: number) => v.toFixed(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800); // same initial value on server and client -> no hydration mismatch
  const [hover, setHover] = useState<{ x: number; t: number; vals: { name: string; color: string; v: number }[] } | null>(null);

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver((e) => { const w = e[0]?.contentRect.width; if (w) setWidth(Math.max(240, Math.floor(w))); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const all = series.flatMap((s) => s.points);
  const model = useMemo(() => {
    if (!all.length) return null;
    let tMin = Infinity, tMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const p of all) { if (p.t < tMin) tMin = p.t; if (p.t > tMax) tMax = p.t; if (p.v < vMin) vMin = p.v; if (p.v > vMax) vMax = p.v; }
    if (baseline !== undefined) { vMin = Math.min(vMin, baseline); vMax = Math.max(vMax, baseline); }
    if (vMax === vMin) { vMax += 1; vMin -= 1; }
    const padV = (vMax - vMin) * 0.06; vMin -= padV; vMax += padV;
    if (tMax === tMin) tMax = tMin + 1;
    const iw = width - PAD.l - PAD.r, ih = height - PAD.t - PAD.b;
    const x = (t: number) => PAD.l + ((t - tMin) / (tMax - tMin)) * iw;
    const y = (v: number) => PAD.t + (1 - (v - vMin) / (vMax - vMin)) * ih;
    const paths = series.map((s) => s.points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(""));
    const area = series[0]?.points.length
      ? `${paths[0]}L${x(series[0].points[series[0].points.length - 1].t).toFixed(1)},${(PAD.t + ih).toFixed(1)}L${x(series[0].points[0].t).toFixed(1)},${(PAD.t + ih).toFixed(1)}Z`
      : "";
    const yt = niceTicks(vMin, vMax, 4);
    const xt = timeTicks(tMin, tMax, Math.max(2, Math.min(6, Math.floor(iw / 140))));
    const xLabel = timeLabel(tMax - tMin);
    return { tMin, tMax, vMin, vMax, x, y, paths, area, yt, xt, xLabel, iw, ih };
  }, [all, series, width, height, baseline]);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!model) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const t = model.tMin + ((px - PAD.l) / model.iw) * (model.tMax - model.tMin);
    const vals: { name: string; color: string; v: number }[] = [];
    let tt = t;
    for (const s of series) {
      if (!s.points.length) continue;
      let lo = 0, hi = s.points.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (s.points[mid].t < t) lo = mid + 1; else hi = mid; }
      const a = s.points[lo], b = s.points[Math.max(0, lo - 1)];
      const p = Math.abs(a.t - t) < Math.abs(b.t - t) ? a : b;
      vals.push({ name: s.name, color: s.color, v: p.v });
      if (s === series[0]) tt = p.t;
    }
    setHover({ x: model.x(tt), t: tt, vals });
  }

  const gradId = `grad-${useId().replace(/[^a-zA-Z0-9]/g, "")}`; // stable across SSR + hydration

  return (
    <div ref={wrapRef} className="relative w-full select-none">
      {series.length >= 2 && (
        <div className="absolute top-1 right-3 z-10 flex gap-3 text-xs text-zinc-400">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4" style={{ background: s.color, borderTop: s.dashed ? `2px dashed ${s.color}` : undefined }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="block">
        {model ? (
          <>
            <defs>
              <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={series[0].color} stopOpacity="0.22" />
                <stop offset="1" stopColor={series[0].color} stopOpacity="0" />
              </linearGradient>
            </defs>
            {model.yt.map((v) => (
              <g key={v}>
                <line x1={PAD.l} x2={width - PAD.r} y1={model.y(v)} y2={model.y(v)} stroke="#26262c" strokeWidth={1} />
                <text x={PAD.l - 8} y={model.y(v) + 3.5} textAnchor="end" fontSize={11} fill="#8b8b95">{fmtY(v)}</text>
              </g>
            ))}
            {model.xt.map((t) => (
              <text key={t} x={model.x(t)} y={height - 7} textAnchor="middle" fontSize={11} fill="#8b8b95">{model.xLabel(t)}</text>
            ))}
            {baseline !== undefined && (
              <line x1={PAD.l} x2={width - PAD.r} y1={model.y(baseline)} y2={model.y(baseline)} stroke="#52525b" strokeDasharray="4 4" strokeWidth={1} />
            )}
            {model.area && <path d={model.area} fill={`url(#${gradId})`} />}
            {series.map((s, i) => (
              <path key={s.name} d={model.paths[i]} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "5 4" : undefined} />
            ))}
            {markerT && markerT >= model.tMin && markerT <= model.tMax && (
              <g>
                <line x1={model.x(markerT)} x2={model.x(markerT)} y1={PAD.t} y2={PAD.t + model.ih} stroke="#fb7185" strokeDasharray="3 3" />
                {markerLabel && <text x={model.x(markerT) + 4} y={PAD.t + 10} fontSize={10} fill="#fb7185">{markerLabel}</text>}
              </g>
            )}
            {hover && (
              <g>
                <line x1={hover.x} x2={hover.x} y1={PAD.t} y2={PAD.t + model.ih} stroke="#71717a" strokeWidth={1} />
                {hover.vals.map((v) => (
                  <circle key={v.name} cx={hover.x} cy={model.y(v.v)} r={4} fill={v.color} stroke="#09090b" strokeWidth={2} />
                ))}
              </g>
            )}
          </>
        ) : (
          <text x={width / 2} y={height / 2} textAnchor="middle" fontSize={13} fill="#8b8b95">{emptyText}</text>
        )}
      </svg>
      {hover && model && (
        <div
          className="pointer-events-none absolute top-2 rounded-md border border-zinc-700 bg-zinc-900/95 px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: Math.min(Math.max(0, (hover.x / width) * 100 - 10), 70) + "%" }}
        >
          <div className="mb-0.5 text-zinc-400">{fmtTime(hover.t)} UTC</div>
          {hover.vals.map((v) => (
            <div key={v.name} className="flex items-center gap-2 num">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: v.color }} />
              <span className="text-zinc-400">{v.name}</span>
              <span className="ml-auto text-zinc-100">{fmtY(v.v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
