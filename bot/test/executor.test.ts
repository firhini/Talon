import { describe, expect, it } from "vitest";
import { buildCloseOrder, buildEntryOrder, buildProtectiveOrders } from "../src/runtime/executor.js";
import type { AssetSpec } from "@talon/core";

const BTC: AssetSpec = { coin: "BTC", assetIndex: 0, szDecimals: 5, maxLeverage: 40 };
const HYPE: AssetSpec = { coin: "HYPE", assetIndex: 159, szDecimals: 2, maxLeverage: 10 };

describe("order builders", () => {
  it("entry is a marketable IOC with capped slippage", () => {
    const o = buildEntryOrder(BTC, "long", 0.0125, 80_000);
    expect(o).toMatchObject({ a: 0, b: true, s: "0.0125", r: false, t: { limit: { tif: "Ioc" } } });
    expect(Number(o.p)).toBe(80_400);
    const s = buildEntryOrder(BTC, "short", 0.0125, 80_000);
    expect(s.b).toBe(false);
    expect(Number(s.p)).toBe(79_600);
  });
  it("protective stop is reduce-only, opposite side, tpsl=sl, market on trigger", () => {
    const [sl, tp] = buildProtectiveOrders(HYPE, "long", 11.75, 81.234567, 95.5);
    expect(sl.r).toBe(true);
    expect(sl.b).toBe(false);
    expect(sl.s).toBe("11.75");
    expect(sl.t).toEqual({ trigger: { isMarket: true, triggerPx: "81.235", tpsl: "sl" } });
    expect(Number(sl.p)).toBeLessThan(81.235); // sell stop limit band below trigger
    expect(tp.t).toEqual({ trigger: { isMarket: true, triggerPx: "95.5", tpsl: "tp" } });
    expect(tp.r).toBe(true);
  });
  it("short stop is a buy above entry", () => {
    const [sl] = buildProtectiveOrders(BTC, "short", 0.01, 86_400, null);
    expect(sl.b).toBe(true);
    expect(Number(sl.p)).toBeGreaterThan(86_400);
    expect(buildProtectiveOrders(BTC, "short", 0.01, 86_400, null).length).toBe(1);
  });
  it("close is reduce-only IOC on the opposite side", () => {
    const c = buildCloseOrder(BTC, "long", 0.01, 80_000);
    expect(c).toMatchObject({ b: false, r: true, t: { limit: { tif: "Ioc" } } });
    expect(Number(c.p)).toBe(79_200);
  });
  it("prices and sizes are strings without exponents", () => {
    const o = buildEntryOrder(BTC, "long", 0.00001, 0.000012);
    expect(o.s).toBe("0.00001");
    expect(o.p).not.toMatch(/e/);
  });
});
