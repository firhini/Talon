import { describe, expect, it } from "vitest";
import { runBacktest } from "../src/backtest.js";
import { specReclaimParams } from "../src/config.js";
import { requiredCandles } from "../src/strategy.js";
import type { AssetSpec, Candle, RiskConfig } from "../src/types.js";
import { baseCandles, candle } from "./helpers.js";

const P = { ...specReclaimParams(), lookback: 20, volumeAvgN: 20, maxSetupBars: 6, atrN: 14, rMultiple: 2 };
const specs = new Map<string, AssetSpec>([["TEST", { coin: "TEST", assetIndex: 0, szDecimals: 2, maxLeverage: 10 }]]);
const risk: RiskConfig = { leverage: 5, maxLeverage: 5, sizeFraction: 0.2, riskPerTradePct: 0, dynamicLeverage: false, compound: false, baseEquity: 1000, hardStopRoe: 0.4, dailyLossLimitPct: 0.5, maxDrawdownPct: 0.5, minNotionalUsd: 10, maxAccountEquity: null };
const fees = { takerFeeBps: 4.5, makerFeeBps: 1.5, slippageBps: 3, defaultHourlyFunding: 0.0000125 };

function series(outcome: "tp" | "stop"): Candle[] {
  const c = baseCandles(requiredCandles(P) + 10);
  let last = c[c.length - 1];
  const H = Math.max(...c.map((k) => k.h));
  c.push((last = candle(last, 100, H + 0.8, 99.8, H + 0.6, 150)));
  c.push((last = candle(last, H + 0.6, H + 0.7, H - 0.5, H - 0.2, 90)));
  c.push((last = candle(last, H - 0.2, H + 0.5, H - 0.3, H + 0.3, 400))); // signal candle
  c.push((last = candle(last, H + 0.3, H + 0.6, H + 0.1, H + 0.4, 100))); // entry at open
  if (outcome === "tp") for (let i = 0; i < 14; i++) c.push((last = candle(last, last.c, last.c + 0.4, last.c - 0.1, last.c + 0.3, 100)));
  else for (let i = 0; i < 6; i++) c.push((last = candle(last, last.c, last.c + 0.2, last.c - 1.5, last.c - 1.2, 100)));
  for (let i = 0; i < 5; i++) c.push((last = candle(last, last.c, last.c + 0.2, last.c - 0.2, last.c, 100)));
  return c;
}

describe("backtester", () => {
  it("fills at next open with slippage, charges fees, hits take profit", () => {
    const c = series("tp");
    const r = runBacktest({ coins: ["TEST"], candles: { TEST: c }, context: { TEST: [] }, funding: {}, interval: "15m", contextInterval: "1h", params: P, risk, fees, specs, startEquity: 1000 });
    expect(r.trades.length).toBe(1);
    const t = r.trades[0];
    const signalIdx = requiredCandles(P) + 12;
    expect(t.entryTime).toBe(c[signalIdx + 1].t);
    expect(t.entryPrice).toBeCloseTo(c[signalIdx + 1].o * (1 + 3 / 10_000), 8);
    expect(t.reasonExit).toMatch(/take profit/);
    expect(t.fees).toBeGreaterThan(0);
    expect(t.pnl).toBeCloseTo(t.grossPnl - t.fees + t.funding, 10);
    expect(t.pnl).toBeGreaterThan(0);
    expect(r.metrics.trades).toBe(1);
    expect(r.metrics.winRate).toBe(1);
    expect(r.metricsNoFees.finalEquity).toBeGreaterThan(r.metrics.finalEquity);
    expect(r.equityCurve[r.equityCurve.length - 1].equity).toBeCloseTo(1000 + t.pnl, 6);
  });
  it("stops out at the stop price with slippage and loses at most the hard ROE", () => {
    const c = series("stop");
    const r = runBacktest({ coins: ["TEST"], candles: { TEST: c }, context: { TEST: [] }, funding: {}, interval: "15m", contextInterval: "1h", params: P, risk, fees, specs, startEquity: 1000 });
    expect(r.trades.length).toBe(1);
    const t = r.trades[0];
    expect(t.reasonExit).toMatch(/stop/);
    expect(t.exitPrice).toBeCloseTo(t.stopPrice * (1 - 3 / 10_000), 8);
    expect(t.pnl).toBeLessThan(0);
    expect(t.roe).toBeGreaterThan(-0.41);
  });
  it("funding is applied hourly while in position", () => {
    const c = series("tp");
    const funding = { TEST: c.map((k) => ({ t: Math.floor(k.t / 3_600_000) * 3_600_000, rate: 0.001 })) };
    const r = runBacktest({ coins: ["TEST"], candles: { TEST: c }, context: { TEST: [] }, funding, interval: "15m", contextInterval: "1h", params: P, risk, fees, specs, startEquity: 1000 });
    expect(r.trades[0].funding).toBeLessThan(0); // long pays positive funding
  });
  it("kill switch flattens and halts on max drawdown", () => {
    const c = series("stop");
    const r = runBacktest({ coins: ["TEST"], candles: { TEST: c }, context: { TEST: [] }, funding: {}, interval: "15m", contextInterval: "1h", params: P, risk: { ...risk, maxDrawdownPct: 0.01 }, fees, specs, startEquity: 1000 });
    expect(r.haltedAt).not.toBeNull();
    expect(r.trades[0].reasonExit).toMatch(/kill switch|stop/);
  });
});
