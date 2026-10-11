import { describe, expect, it } from "vitest";
import { specReclaimParams } from "../src/config.js";
import { contextTrend, contextUpTo, evaluateEntry, manage, requiredCandles, type StrategyContext } from "../src/strategy.js";
import type { Candle, Position } from "../src/types.js";
import { baseCandles, candle } from "./helpers.js";

const P = { ...specReclaimParams(), lookback: 20, volumeAvgN: 20, maxSetupBars: 6, atrN: 14 };
const ctxOf = (candles: Candle[], params = P, context: Candle[] = []): StrategyContext => ({ coin: "TEST", candles, context, params });

/** base, then breakout close above 100.5 (level = highest high of base), pullback close below, reclaim close above on volume. */
function longReclaimSeries(reclaimVol = 400, reclaimClose = 101.0): Candle[] {
  const c = baseCandles(requiredCandles(P) + 10);
  let last = c[c.length - 1];
  const H = Math.max(...c.map((k) => k.h)); // 100.7
  c.push((last = candle(last, 100, H + 0.8, 99.8, H + 0.6, 150)));   // breakout close above level
  c.push((last = candle(last, H + 0.6, H + 0.7, H - 0.5, H - 0.2, 90))); // pullback: closes back below level
  c.push((last = candle(last, H - 0.2, reclaimClose + 0.1, H - 0.3, reclaimClose, reclaimVol))); // reclaim
  return c;
}

describe("reclaim strategy", () => {
  it("returns null during warmup", () => {
    expect(evaluateEntry(ctxOf(baseCandles(10)))).toBeNull();
  });
  it("no signal on a quiet base", () => {
    expect(evaluateEntry(ctxOf(baseCandles(requiredCandles(P) + 20)))).toBeNull();
  });
  it("long reclaim with volume confirmation fires with stop below pullback low and 3R target", () => {
    const c = longReclaimSeries();
    const s = evaluateEntry(ctxOf(c));
    expect(s).not.toBeNull();
    expect(s!.side).toBe("long");
    expect(s!.level).toBeCloseTo(100.7, 6);
    expect(s!.volumeRatio).toBeGreaterThan(1.5);
    expect(s!.stopPrice).toBeLessThan(s!.refPrice);
    const R = s!.refPrice - s!.stopPrice;
    expect(s!.tpPrice).toBeCloseTo(s!.refPrice + 3 * R, 8);
    expect(s!.reason).toMatch(/reclaim long/);
  });
  it("no volume confirmation = no trade", () => {
    const s = evaluateEntry(ctxOf(longReclaimSeries(120)));
    expect(s).toBeNull();
  });
  it("never chase: reclaim close far above level is rejected", () => {
    const s = evaluateEntry(ctxOf(longReclaimSeries(400, 108)));
    expect(s).toBeNull();
  });
  it("breakout without pullback is not an entry", () => {
    const c = baseCandles(requiredCandles(P) + 10);
    let last = c[c.length - 1];
    const H = Math.max(...c.map((k) => k.h));
    c.push((last = candle(last, 100, H + 0.8, 99.8, H + 0.6, 400)));
    expect(evaluateEntry(ctxOf(c))).toBeNull();
    c.push((last = candle(last, H + 0.6, H + 1.2, H + 0.4, H + 1.0, 400))); // continues up, still no pullback
    expect(evaluateEntry(ctxOf(c))).toBeNull();
  });
  it("short reclaim mirrors the long logic", () => {
    const c = baseCandles(requiredCandles(P) + 10);
    let last = c[c.length - 1];
    const L = Math.min(...c.map((k) => k.l));
    c.push((last = candle(last, 100, 100.2, L - 0.8, L - 0.6, 150)));
    c.push((last = candle(last, L - 0.6, L + 0.5, L - 0.7, L + 0.2, 90)));
    c.push((last = candle(last, L + 0.2, L + 0.3, L - 1.1, L - 1.0, 400)));
    const s = evaluateEntry(ctxOf(c));
    expect(s?.side).toBe("short");
    expect(s!.stopPrice).toBeGreaterThan(s!.refPrice);
    expect(s!.tpPrice!).toBeLessThan(s!.refPrice);
  });
  it("allowShort=false blocks shorts", () => {
    const c = baseCandles(requiredCandles(P) + 10);
    let last = c[c.length - 1];
    const L = Math.min(...c.map((k) => k.l));
    c.push((last = candle(last, 100, 100.2, L - 0.8, L - 0.6, 150)));
    c.push((last = candle(last, L - 0.6, L + 0.5, L - 0.7, L + 0.2, 90)));
    c.push((last = candle(last, L + 0.2, L + 0.3, L - 1.1, L - 1.0, 400)));
    expect(evaluateEntry(ctxOf(c, { ...P, allowShort: false }))).toBeNull();
  });
  it("ema trend filter blocks longs in a downtrend", () => {
    const c = longReclaimSeries();
    const down: Candle[] = [];
    for (let i = 0; i < 300; i++) { const px = 200 - i * 0.3; down.push({ t: i * 3_600_000, o: px, h: px + 0.1, l: px - 0.1, c: px, v: 1 }); }
    expect(contextTrend(down, 50).bias).toBe("down");
    expect(evaluateEntry(ctxOf(c, { ...P, trendFilter: "ema" }, down))).toBeNull();
    const up = down.map((k, i) => ({ ...k, o: 100 + i * 0.3, h: 100 + i * 0.3 + 0.1, l: 100 + i * 0.3 - 0.1, c: 100 + i * 0.3 }));
    expect(contextTrend(up, 50).bias).toBe("up");
    expect(evaluateEntry(ctxOf(c, { ...P, trendFilter: "ema" }, up))?.side).toBe("long");
  });
  it("is deterministic and pure (same input, same output, no mutation)", () => {
    const c = longReclaimSeries();
    const snapshot = JSON.stringify(c);
    const a = evaluateEntry(ctxOf(c)), b = evaluateEntry(ctxOf(c));
    expect(a).toEqual(b);
    expect(JSON.stringify(c)).toBe(snapshot);
  });
});

describe("donchian strategy", () => {
  const D = { ...P, name: "donchian" as const, volumeMult: 0, stopAtrMult: 2, exitLookback: 20 };
  it("enters on channel breakout close with ATR stop", () => {
    const c = baseCandles(requiredCandles(D) + 10);
    const last = c[c.length - 1];
    const H = Math.max(...c.map((k) => k.h));
    c.push(candle(last, 100, H + 0.6, 99.9, H + 0.4, 100));
    const s = evaluateEntry(ctxOf(c, D));
    expect(s?.side).toBe("long");
    expect(s!.refPrice - s!.stopPrice).toBeCloseTo(2 * s!.atr, 8);
  });
  it("manage exits on opposite channel", () => {
    const c = baseCandles(requiredCandles(D) + 10);
    const last = c[c.length - 1];
    const L = Math.min(...c.map((k) => k.l));
    c.push(candle(last, 100, 100.1, L - 1, L - 0.9, 100));
    const pos: Position = { coin: "TEST", side: "long", qty: 1, entryPrice: 100, entryTime: 0, leverage: 5, margin: 20, stopPrice: 90, tpPrice: null, initialStop: 90, atr: 1, bestPrice: 100, barsHeld: 3, reasonEntry: "", funding: 0, fees: 0 };
    expect(manage(ctxOf(c, D), pos)?.exit?.reason).toMatch(/channel exit/);
  });
});

describe("manage: trailing & time stop", () => {
  const pos = (over: Partial<Position> = {}): Position => ({ coin: "TEST", side: "long", qty: 1, entryPrice: 100, entryTime: 0, leverage: 5, margin: 20, stopPrice: 98, tpPrice: null, initialStop: 98, atr: 1, bestPrice: 100, barsHeld: 0, reasonEntry: "", funding: 0, fees: 0, ...over });
  it("trailing stop only tightens and only after trailAfterR", () => {
    const p = { ...P, trailAtrMult: 2, trailAfterR: 1 };
    const c = baseCandles(requiredCandles(P) + 5);
    // price at 100.x: profit < 1R (R=2) → no trail
    expect(manage(ctxOf(c, p), pos())).toBeNull();
    const last = c[c.length - 1];
    c.push(candle(last, 104, 106, 103.5, 105, 100)); // +5 = 2.5R
    const act = manage(ctxOf(c, p), pos({ bestPrice: 104 }));
    expect(act?.newStop).toBeDefined();
    expect(act!.newStop!).toBeGreaterThan(98);
    expect(act!.newStop!).toBeLessThan(106);
    // never loosens
    const act2 = manage(ctxOf(c, p), pos({ bestPrice: 106, stopPrice: 105.9 }));
    expect(act2).toBeNull();
  });
  it("time stop", () => {
    const c = baseCandles(requiredCandles(P) + 5);
    expect(manage(ctxOf(c, { ...P, timeStopBars: 10 }), pos({ barsHeld: 10 }))?.exit?.reason).toMatch(/time stop/);
    expect(manage(ctxOf(c, { ...P, timeStopBars: 10 }), pos({ barsHeld: 9 }))).toBeNull();
  });
});

describe("contextUpTo has no lookahead", () => {
  it("only returns context candles closed at or before closeTime", () => {
    const ctx: Candle[] = [0, 1, 2, 3].map((i) => ({ t: i * 3_600_000, o: 1, h: 1, l: 1, c: 1, v: 1 }));
    expect(contextUpTo(ctx, 3_600_000, 3_600_000 + 900_000).length).toBe(1); // 15m into hour 1: only hour 0 closed
    expect(contextUpTo(ctx, 3_600_000, 2 * 3_600_000).length).toBe(2);
    expect(contextUpTo(ctx, 3_600_000, 10 * 3_600_000).length).toBe(4);
  });
});

describe("apex strategy + pyramiding", () => {
  const A = { ...P, name: "apex" as const, volumeMult: 0, stopAtrMult: 2, rMultiple: 0, trailAtrMult: 3, trailAfterR: 0, trendFilter: "ema" as const, regimeErMin: 0.3, regimeErN: 10, maxUnits: 4, addEveryAtr: 1 };
  const up: Candle[] = [];
  for (let i = 0; i < 300; i++) { const px = 100 + i * 0.3; up.push({ t: i * 3_600_000, o: px, h: px + 0.1, l: px - 0.1, c: px, v: 1 }); }
  const chop: Candle[] = up.map((k, i) => ({ ...k, c: 150 + (i % 2 ? 1 : -1), o: 150, h: 151.2, l: 148.8 }));
  function breakout(): Candle[] {
    const c = baseCandles(requiredCandles(A) + 10);
    const last = c[c.length - 1];
    const H = Math.max(...c.map((k) => k.h));
    c.push(candle(last, 100, H + 0.6, 99.9, H + 0.4, 100));
    return c;
  }
  it("enters a breakout only with the context trend and a trending regime", () => {
    const s = evaluateEntry(ctxOf(breakout(), A, up));
    expect(s?.side).toBe("long");
    expect(s!.tpPrice).toBeNull();
    expect(s!.refPrice - s!.stopPrice).toBeCloseTo(2 * s!.atr, 8);
    expect(evaluateEntry(ctxOf(breakout(), A, chop))).toBeNull(); // efficiency ratio ~0 → no trade
    const down = up.map((k, i) => ({ ...k, o: 200 - i * 0.3, h: 200 - i * 0.3 + 0.1, l: 200 - i * 0.3 - 0.1, c: 200 - i * 0.3 }));
    expect(evaluateEntry(ctxOf(breakout(), A, down))).toBeNull(); // long breakout against a downtrend
  });
  it("requests a pyramid add after addEveryAtr of favourable movement, up to maxUnits", () => {
    const c = baseCandles(requiredCandles(A) + 5);
    const last = c[c.length - 1];
    c.push(candle(last, 100, 103.5, 99.9, 103, 100)); // big move up
    const pos: Position = { coin: "TEST", side: "long", qty: 1, entryPrice: 100, entryTime: 0, leverage: 20, margin: 5, stopPrice: 98, tpPrice: null, initialStop: 98, atr: 1, bestPrice: 100, barsHeld: 1, reasonEntry: "", funding: 0, fees: 0, units: 1, lastFillPrice: 100, equityBefore: 1000 };
    const act = manage(ctxOf(c, A, up), pos);
    expect(act?.addUnit).toBeDefined();
    expect(act!.addUnit!.stopPrice).toBeLessThan(act!.addUnit!.refPrice);
    expect(manage(ctxOf(c, A, up), { ...pos, units: 4 })?.addUnit).toBeUndefined();
    expect(manage(ctxOf(c, A, up), { ...pos, lastFillPrice: 102.8 })?.addUnit).toBeUndefined(); // not enough movement since last fill
  });
});
