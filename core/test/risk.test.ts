import { describe, expect, it } from "vitest";
import { HARD_MAX_LEVERAGE } from "../src/config.js";
import { RiskGuard, rollAccountDay } from "../src/risk.js";
import type { AccountState, AssetSpec, OrderIntent, RiskConfig } from "../src/types.js";

const specs = new Map<string, AssetSpec>([
  ["BTC", { coin: "BTC", assetIndex: 0, szDecimals: 5, maxLeverage: 40 }],
  ["HYPE", { coin: "HYPE", assetIndex: 4, szDecimals: 2, maxLeverage: 10 }],
  ["ATOM", { coin: "ATOM", assetIndex: 9, szDecimals: 2, maxLeverage: 3 }],
]);
const cfg: RiskConfig = { leverage: 5, maxLeverage: 5, sizeFraction: 0.2, riskPerTradePct: 0, compound: false, baseEquity: 1000, hardStopRoe: 0.4, dailyLossLimitPct: 0.05, maxDrawdownPct: 0.15, minNotionalUsd: 10, maxAccountEquity: null };
const acct = (o: Partial<AccountState> = {}): AccountState => ({ equity: 1000, dayStartEquity: 1000, peakEquity: 1000, dayPnl: 0, position: null, halted: false, haltReason: null, ...o });
const intent = (o: Partial<OrderIntent> = {}): OrderIntent => ({ coin: "BTC", side: "long", refPrice: 80_000, stopPrice: 79_000, tpPrice: 83_000, leverage: 5, reason: "t", ...o });

describe("RiskGuard", () => {
  const g = new RiskGuard(cfg, specs);
  it("approves a normal order with 20% of equity at 5x", () => {
    const d = g.approve(intent(), acct());
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.order.leverage).toBe(5);
    expect(d.order.margin).toBeCloseTo(200, 0);
    expect(d.order.notional).toBeLessThanOrEqual(1000.0001);
    expect(d.order.qty).toBeCloseTo(0.0125, 5);
    expect(d.order.stopPrice).toBe(79_000);
    expect(d.order.__approved).toBe(true);
  });
  it("hard leverage ceiling in code", () => {
    expect(() => new RiskGuard({ ...cfg, maxLeverage: 11 }, specs)).toThrow();
    const g10 = new RiskGuard({ ...cfg, leverage: 10, maxLeverage: 10 }, specs);
    expect(g10.effectiveLeverage("BTC", 50)).toBe(HARD_MAX_LEVERAGE);
    expect(g10.effectiveLeverage("ATOM", 10)).toBe(3); // exchange max
    expect(g.effectiveLeverage("BTC", 10)).toBe(5); // configured cap
  });
  it("one position at a time", () => {
    const d = g.approve(intent(), acct({ position: { coin: "ETH", side: "long" } as never }));
    expect(d.ok).toBe(false);
  });
  it("rejects when halted, daily loss or drawdown exceeded", () => {
    expect(g.approve(intent(), acct({ halted: true, haltReason: "kill" })).ok).toBe(false);
    expect(g.approve(intent(), acct({ equity: 940 })).ok).toBe(false); // -6% daily
    expect(g.checkHalt(acct({ equity: 940 }))).toMatch(/daily loss/);
    expect(g.checkHalt(acct({ equity: 960 }))).toBeNull();
    expect(g.checkHalt(acct({ equity: 840, dayStartEquity: 850, peakEquity: 1000 }))).toMatch(/max drawdown/);
  });
  it("requires a stop on the correct side", () => {
    expect(g.approve(intent({ stopPrice: NaN }), acct()).ok).toBe(false);
    expect(g.approve(intent({ stopPrice: 0 }), acct()).ok).toBe(false);
    expect(g.approve(intent({ stopPrice: 81_000 }), acct()).ok).toBe(false);
    expect(g.approve(intent({ side: "short", stopPrice: 79_000 }), acct()).ok).toBe(false);
  });
  it("clamps the stop to the -40% ROE hard stop", () => {
    const d = g.approve(intent({ stopPrice: 60_000 }), acct());
    expect(d.ok && d.order.stopPrice).toBe(73_600); // 80000 * (1 - 0.4/5)
    const s = g.approve(intent({ side: "short", stopPrice: 100_000, tpPrice: 70_000 }), acct());
    expect(s.ok && s.order.stopPrice).toBe(86_400);
  });
  it("skips trades below exchange min notional", () => {
    const d = g.approve(intent(), acct({ equity: 8, peakEquity: 8, dayStartEquity: 8 }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/too small/);
  });
  it("rounds size to szDecimals and never exceeds the margin budget", () => {
    const d = g.approve(intent({ coin: "HYPE", refPrice: 85.123, stopPrice: 83 }), acct());
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.order.qty).toBe(Math.floor(d.order.qty * 100) / 100);
    expect(d.order.notional).toBeLessThanOrEqual(1000);
  });
  it("sizes from base equity when compounding is off, from equity when on", () => {
    const off = g.approve(intent(), acct({ equity: 2000, peakEquity: 2000, dayStartEquity: 2000 }));
    expect(off.ok && off.order.margin).toBeCloseTo(200, 0);
    const on = new RiskGuard({ ...cfg, compound: true }, specs).approve(intent(), acct({ equity: 2000, peakEquity: 2000, dayStartEquity: 2000 }));
    expect(on.ok && on.order.margin).toBeCloseTo(400, 0);
    const shrunk = g.approve(intent(), acct({ equity: 500, peakEquity: 500, dayStartEquity: 500 }));
    expect(shrunk.ok && shrunk.order.margin).toBeCloseTo(100, 0); // min(base, equity) * 20%
  });
  it("risk-per-trade cap shrinks size for wide stops and never enlarges it", () => {
    const rg = new RiskGuard({ ...cfg, riskPerTradePct: 0.01 }, specs);
    const wide = rg.approve(intent({ stopPrice: 76_000 }), acct()); // 5% stop → notional = 1000*0.01/0.05 = 200
    expect(wide.ok && wide.order.notional).toBeCloseTo(200, 0);
    const tight = rg.approve(intent({ stopPrice: 79_800 }), acct()); // 0.25% stop → cap 4000 > 1000 → stays 1000
    expect(tight.ok && tight.order.notional).toBeLessThanOrEqual(1000.01);
    expect(tight.ok && tight.order.notional).toBeGreaterThan(990);
  });
  it("live equity cap", () => {
    const capped = new RiskGuard({ ...cfg, maxAccountEquity: 500 }, specs);
    expect(capped.approve(intent(), acct()).ok).toBe(false);
    expect(capped.approve(intent(), acct({ equity: 400, peakEquity: 400, dayStartEquity: 400 })).ok).toBe(true);
  });
  it("unknown asset rejected", () => {
    expect(g.approve(intent({ coin: "DOGE" }), acct()).ok).toBe(false);
  });
  it("rollAccountDay resets day start on a new UTC day and tracks peak", () => {
    const a = rollAccountDay(acct({ dayStartEquity: 900 }), 1100, 86_400_000 * 2 + 1, 86_400_000 * 1 + 5);
    expect(a.dayStartEquity).toBe(1100);
    expect(a.peakEquity).toBe(1100);
    const b = rollAccountDay(acct({ dayStartEquity: 900 }), 950, 86_400_000 * 2 + 1000, 86_400_000 * 2 + 1);
    expect(b.dayStartEquity).toBe(900);
  });
});
