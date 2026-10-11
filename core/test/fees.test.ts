import { describe, expect, it } from "vitest";
import { clampStop, feeCost, fmtNum, fundingPayment, grossPnl, hardStopPrice, isBuy, roe, roundPrice, roundSize, slippedPrice, stopDistancePct } from "../src/fees.js";

describe("fees & funding math", () => {
  it("taker fee on notional", () => {
    expect(feeCost(10_000, 4.5)).toBeCloseTo(4.5, 10);
    expect(feeCost(-10_000, 4.5)).toBeCloseTo(4.5, 10);
  });
  it("slippage hurts in both directions", () => {
    expect(slippedPrice(100, true, 10)).toBeCloseTo(100.1);
    expect(slippedPrice(100, false, 10)).toBeCloseTo(99.9);
  });
  it("buy/sell mapping", () => {
    expect(isBuy("long", "open")).toBe(true);
    expect(isBuy("long", "close")).toBe(false);
    expect(isBuy("short", "open")).toBe(false);
    expect(isBuy("short", "close")).toBe(true);
  });
  it("gross pnl", () => {
    expect(grossPnl("long", 100, 110, 2)).toBe(20);
    expect(grossPnl("short", 100, 110, 2)).toBe(-20);
  });
  it("funding: longs pay when positive, shorts receive", () => {
    expect(fundingPayment("long", 10_000, 0.0001)).toBeCloseTo(-1);
    expect(fundingPayment("short", 10_000, 0.0001)).toBeCloseTo(1);
    expect(fundingPayment("long", 10_000, -0.0001)).toBeCloseTo(1);
  });
  it("roe", () => {
    expect(roe(50, 200)).toBe(0.25);
    expect(roe(50, 0)).toBe(0);
  });
  it("hard stop at -40% ROE with 5x = 8% price move", () => {
    expect(hardStopPrice("long", 100, 5, 0.4)).toBeCloseTo(92);
    expect(hardStopPrice("short", 100, 5, 0.4)).toBeCloseTo(108);
    expect(hardStopPrice("long", 100, 10, 0.4)).toBeCloseTo(96);
  });
  it("clampStop picks the nearer stop", () => {
    expect(clampStop("long", 90, 92)).toBe(92);
    expect(clampStop("long", 95, 92)).toBe(95);
    expect(clampStop("short", 110, 108)).toBe(108);
    expect(clampStop("short", 105, 108)).toBe(105);
  });
  it("hyperliquid price rounding: 5 sig figs, max 6-szDecimals decimals", () => {
    expect(roundPrice(71922.123, 5)).toBe(71922);
    expect(roundPrice(2500.456, 4)).toBe(2500.5);
    expect(roundPrice(109.33567, 2)).toBe(109.34);
    expect(roundPrice(0.0123456, 0)).toBe(0.012346);
    expect(roundPrice(1.23456789, 2)).toBe(1.2346);
  });
  it("size rounds down to szDecimals", () => {
    expect(roundSize(0.123456, 5)).toBe(0.12345);
    expect(roundSize(1.999, 2)).toBe(1.99);
    expect(roundSize(0.1 + 0.2, 1)).toBe(0.3);
  });
  it("fmtNum has no exponent and no trailing zeros", () => {
    expect(fmtNum(0.00001)).toBe("0.00001");
    expect(fmtNum(71922)).toBe("71922");
    expect(fmtNum(2500.5)).toBe("2500.5");
  });
  it("stop distance pct", () => {
    expect(stopDistancePct("long", 100, 95)).toBeCloseTo(0.05);
    expect(stopDistancePct("short", 100, 105)).toBeCloseTo(0.05);
  });
});
