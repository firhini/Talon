import {
  computeMetrics, formatReport, loadCandles, loadConfig, loadFunding, openDb, runBacktest, saveBacktest,
  type AssetSpec, type BacktestInput, type BacktestResult, type Interval, type Metrics, type StrategyParams, type Trade,
} from "@talon/core";
import { arg, flag, loadEnv, parseDate } from "../env.js";

loadEnv();
const cfg = loadConfig({ ...process.env, MODE: "backtest" });
const db = openDb(arg("db", cfg.dbPath)!);
const source = arg("source", "okx")!;
const from = parseDate(arg("from"), 0);
const to = parseDate(arg("to"), Number.MAX_SAFE_INTEGER);
const startEquity = Number(arg("equity", String(cfg.paperStartEquity)));
const coins = (arg("coins", cfg.universe.join(",")) as string).split(",");

/** Exchange specs for backtesting (Hyperliquid perps, Oct 2026). */
const SPECS: Record<string, AssetSpec> = {
  BTC: { coin: "BTC", assetIndex: 0, szDecimals: 5, maxLeverage: 40 },
  ETH: { coin: "ETH", assetIndex: 1, szDecimals: 4, maxLeverage: 25 },
  SOL: { coin: "SOL", assetIndex: 5, szDecimals: 2, maxLeverage: 20 },
  BNB: { coin: "BNB", assetIndex: 7, szDecimals: 3, maxLeverage: 10 },
  HYPE: { coin: "HYPE", assetIndex: 159, szDecimals: 2, maxLeverage: 10 },
};
const specs = new Map(coins.map((c) => [c, SPECS[c] ?? { coin: c, assetIndex: -1, szDecimals: 2, maxLeverage: 10 }]));

const CONTEXT_OF: Record<string, Interval> = { "15m": "1h", "1h": "4h", "4h": "1d" };
const cache = new Map<string, BacktestInput["candles"]>();
function data(interval: Interval): { candles: BacktestInput["candles"]; context: BacktestInput["context"]; funding: BacktestInput["funding"] } {
  const ctxIv = CONTEXT_OF[interval];
  const load = (iv: Interval) => {
    const k = `${iv}`;
    if (!cache.has(k)) cache.set(k, Object.fromEntries(coins.map((c) => [c, loadCandles(db, source, c, iv)])));
    return cache.get(k)!;
  };
  const funding = Object.fromEntries(coins.map((c) => [c, loadFunding(db, c)]));
  return { candles: load(interval), context: load(ctxIv), funding };
}

function run(params: StrategyParams, interval: Interval, label: string, opts: { from?: number; to?: number; killSwitch?: "halt" | "off"; leverage?: number } = {}): BacktestResult {
  const d = data(interval);
  return runBacktest({
    coins, ...d, interval, contextInterval: CONTEXT_OF[interval], params,
    risk: { ...cfg.risk, leverage: opts.leverage ?? cfg.risk.leverage }, fees: cfg.fees, specs, startEquity,
    from: opts.from ?? from, to: opts.to ?? to, killSwitch: opts.killSwitch ?? "halt",
  }, label);
}

const interval = (arg("interval", cfg.interval) as Interval);
if (flag("sweep")) {
  // Research grid: kill switch off so every variant is judged on the full period.
  const grid: { params: Partial<StrategyParams>; interval: Interval }[] = [];
  for (const iv of ["15m", "1h"] as Interval[]) {
    for (const name of ["reclaim", "donchian"] as const) {
      for (const lookback of iv === "15m" ? [48, 96] : [24, 48, 96]) {
        for (const trendFilter of ["none", "ema"] as const) {
          for (const stopAtrMult of name === "reclaim" ? [1, 1.5] : [2, 3]) {
            for (const exit of [{ rMultiple: 3, trailAtrMult: 0 }, { rMultiple: 2, trailAtrMult: 0 }, { rMultiple: 0, trailAtrMult: 3 }, { rMultiple: 4, trailAtrMult: 2 }]) {
              for (const volumeMult of name === "reclaim" ? [1.5, 2] : [0, 1.5]) {
                grid.push({ interval: iv, params: { name, lookback, trendFilter, stopAtrMult, volumeMult, ...exit, exitLookback: name === "donchian" ? Math.round(lookback / 2) : 0 } });
              }
            }
          }
        }
      }
    }
  }
  const customGrid = arg("grid");
  if (customGrid) {
    // e.g. --grid "lookback=36,48,60;stopAtrMult=1.5,2;rMultiple=2,3" with --strategy/--interval as the base
    grid.length = 0;
    const dims = customGrid.split(";").map((d) => { const [k, vs] = d.split("="); return { k: k.trim(), vs: vs.split(",").map((v) => (v === "none" || v === "ema" ? v : Number(v))) }; });
    const base: Partial<StrategyParams> = { name: (arg("strategy", cfg.strategy.name) as StrategyParams["name"]) };
    const rec = (i: number, acc: Record<string, unknown>) => {
      if (i === dims.length) { grid.push({ interval, params: { ...base, ...acc } as Partial<StrategyParams> }); return; }
      for (const v of dims[i].vs) rec(i + 1, { ...acc, [dims[i].k]: v });
    };
    rec(0, {});
  }
  const only = arg("only");
  const validateFrom = arg("validate-from") ? parseDate(arg("validate-from"), 0) : null;
  const rows: { label: string; r: BacktestResult; is: Metrics; oos: Metrics | null }[] = [];
  const t0 = Date.now();
  let i = 0;
  const subset = (ts: Trade[]): Metrics => {
    let eq = startEquity;
    const curve = [{ t: ts[0]?.entryTime ?? 0, equity: eq }];
    for (const t of ts) { eq += t.pnl; curve.push({ t: t.exitTime, equity: eq }); }
    return computeMetrics(ts, curve, startEquity, 0);
  };
  for (const g of grid) {
    const p = { ...cfg.strategy, ...g.params };
    const label = `${p.name}-${g.interval}-lb${p.lookback}-${p.trendFilter}-s${p.stopAtrMult}-R${p.rMultiple}-tr${p.trailAtrMult}-v${p.volumeMult}`;
    if (only && !label.includes(only)) continue;
    const r = run(p, g.interval, label, { killSwitch: "off" });
    const is = validateFrom ? subset(r.trades.filter((t) => t.entryTime < validateFrom)) : r.metrics;
    const oos = validateFrom ? subset(r.trades.filter((t) => t.entryTime >= validateFrom)) : null;
    rows.push({ label, r, is, oos });
    i++;
    if (i % 10 === 0) console.error(`  ${i}/${grid.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  rows.sort((a, b) => score(b.is) - score(a.is));
  const fmt = (m: Metrics) => `${String(m.trades).padStart(5)} ${(m.winRate * 100).toFixed(0).padStart(4)} ${m.expectancyR.toFixed(2).padStart(6)} ${(Number.isFinite(m.profitFactor) ? Math.min(m.profitFactor, 99) : 99).toFixed(2).padStart(5)} ${(m.maxDrawdownPct * 100).toFixed(1).padStart(5)} ${(m.totalReturnPct * 100).toFixed(1).padStart(7)}`;
  console.log("label".padEnd(50) + "|  IS: n  win%  expR    PF   DD%    ret% |" + (validateFrom ? " OOS: n  win%  expR    PF   DD%    ret% |" : "") + " noFee%");
  for (const { label, r, is, oos } of rows) {
    console.log(`${label.padEnd(50)}| ${fmt(is)} |${oos ? ` ${fmt(oos)} |` : ""} ${(r.metricsNoFees.totalReturnPct * 100).toFixed(1).padStart(6)}`);
  }
  if (flag("save")) for (const { label, r } of rows.slice(0, 10)) saveBacktest(db, `sweep:${label}`, { ...r.params, interval: r.params, risk: r.risk, fees: r.fees }, { ...r.metrics, noFees: r.metricsNoFees, from: r.from, to: r.to, haltedAt: r.haltedAt, haltReason: r.haltReason }, r.equityCurve, r.trades);
} else {
  const label = arg("label", `${cfg.strategy.name}-${interval}`)!;
  const r = run(cfg.strategy, interval, label, { killSwitch: (arg("kill", "halt") as "halt" | "off") });
  console.log(formatReport(r));
  if (flag("trades")) for (const t of r.trades) console.log(`${new Date(t.entryTime).toISOString().slice(0, 16)} ${t.coin.padEnd(4)} ${t.side.padEnd(5)} ${t.leverage}x in ${t.entryPrice.toFixed(2)} out ${t.exitPrice.toFixed(2)} roe ${(t.roe * 100).toFixed(1).padStart(6)}% pnl ${t.pnl.toFixed(2).padStart(8)} fees ${t.fees.toFixed(2)} fund ${t.funding.toFixed(2)} | ${t.reasonExit}`);
  if (flag("breakdown")) {
    const agg = (key: (t: Trade) => string) => {
      const m = new Map<string, { n: number; pnl: number; wins: number }>();
      for (const t of r.trades) { const k = key(t); const e = m.get(k) ?? { n: 0, pnl: 0, wins: 0 }; e.n++; e.pnl += t.pnl; if (t.pnl > 0) e.wins++; m.set(k, e); }
      return [...m.entries()].sort();
    };
    console.log("\nby coin:");
    for (const [k, e] of agg((t) => t.coin)) console.log(`  ${k.padEnd(5)} n=${String(e.n).padStart(4)} win=${((e.wins / e.n) * 100).toFixed(0).padStart(3)}% pnl=${e.pnl.toFixed(2).padStart(9)}`);
    console.log("by month:");
    for (const [k, e] of agg((t) => new Date(t.entryTime).toISOString().slice(0, 7))) console.log(`  ${k} n=${String(e.n).padStart(4)} win=${((e.wins / e.n) * 100).toFixed(0).padStart(3)}% pnl=${e.pnl.toFixed(2).padStart(9)}`);
    console.log("by side:");
    for (const [k, e] of agg((t) => t.side)) console.log(`  ${k.padEnd(5)} n=${String(e.n).padStart(4)} win=${((e.wins / e.n) * 100).toFixed(0).padStart(3)}% pnl=${e.pnl.toFixed(2).padStart(9)}`);
  }
  if (flag("save") || !flag("nosave")) {
    const id = saveBacktest(db, label, { ...r.params, interval, contextInterval: CONTEXT_OF[interval], risk: r.risk, fees: r.fees, startEquity, coins },
      { ...r.metrics, noFees: r.metricsNoFees, from: r.from, to: r.to, haltedAt: r.haltedAt, haltReason: r.haltReason, dailyHalts: r.dailyHalts }, r.equityCurve, r.trades);
    console.log(`saved backtest #${id}`);
  }
}
db.close();

/** Rank by risk-adjusted net return; penalise tiny samples. */
function score(m: Metrics): number {
  if (m.trades < 15) return -1e9 + m.trades;
  const pf = Number.isFinite(m.profitFactor) ? m.profitFactor : 5;
  return m.sharpe * 0.5 + Math.min(pf, 3) + m.totalReturnPct - m.maxDrawdownPct * 2;
}
