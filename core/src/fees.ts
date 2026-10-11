import type { Side } from "./types.js";

/** Hyperliquid perps: max 6 decimals, max 5 significant figures (integers always allowed). */
export const PERP_MAX_DECIMALS = 6;

export function feeCost(notional: number, bps: number): number {
  return Math.abs(notional) * bps / 10_000;
}

/** Price actually paid/received after slippage. Buys fill higher, sells fill lower. */
export function slippedPrice(price: number, isBuy: boolean, slippageBps: number): number {
  const f = slippageBps / 10_000;
  return isBuy ? price * (1 + f) : price * (1 - f);
}

/** Opening a long or closing a short is a buy. */
export function isBuy(side: Side, action: "open" | "close"): boolean {
  return (side === "long") === (action === "open");
}

export function grossPnl(side: Side, entry: number, exit: number, qty: number): number {
  return side === "long" ? (exit - entry) * qty : (entry - exit) * qty;
}

/**
 * Funding cash flow for one funding interval. Positive = received.
 * Positive rate: longs pay shorts.
 */
export function fundingPayment(side: Side, notional: number, rate: number): number {
  const paidByLongs = Math.abs(notional) * rate;
  return side === "long" ? -paidByLongs : paidByLongs;
}

export function roe(netPnl: number, margin: number): number {
  return margin > 0 ? netPnl / margin : 0;
}

/** Price at which loss equals hardStopRoe of margin (ignoring fees). */
export function hardStopPrice(side: Side, entry: number, leverage: number, hardStopRoe: number): number {
  const d = entry * hardStopRoe / leverage;
  return side === "long" ? entry - d : entry + d;
}

/** The nearer of structural and hard stop, so loss never exceeds the hard stop. */
export function clampStop(side: Side, structural: number, hard: number): number {
  return side === "long" ? Math.max(structural, hard) : Math.min(structural, hard);
}

export function roundDownToDecimals(x: number, decimals: number): number {
  const m = 10 ** decimals;
  return Math.floor(x * m + 1e-9) / m;
}

/** Hyperliquid price rounding: 5 significant figures and at most (6 - szDecimals) decimals. */
export function roundPrice(px: number, szDecimals: number): number {
  if (!(px > 0)) return px;
  const maxDec = PERP_MAX_DECIMALS - szDecimals;
  if (Number.isInteger(px)) return px;
  const sig = Number(px.toPrecision(5));
  const dec = Math.max(0, Math.min(maxDec, countDecimals(sig)));
  return Number(sig.toFixed(dec));
}

export function roundSize(sz: number, szDecimals: number): number {
  return roundDownToDecimals(sz, szDecimals);
}

function countDecimals(x: number): number {
  const s = x.toString();
  if (s.includes("e-")) return Number(s.split("e-")[1]) + (s.split(".")[1]?.split("e")[0].length ?? 0);
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

/** Format a number for the Hyperliquid API (no exponent, no trailing zeros). */
export function fmtNum(x: number): string {
  let s = x.toFixed(10);
  s = s.replace(/\.?0+$/, "");
  return s === "" || s === "-0" ? "0" : s;
}

/** Unrealized pnl at a mark price. */
export function unrealizedPnl(side: Side, entry: number, mark: number, qty: number): number {
  return grossPnl(side, entry, mark, qty);
}

/** Distance from mark to stop as a fraction of mark (positive = stop not yet hit). */
export function stopDistancePct(side: Side, mark: number, stop: number): number {
  return side === "long" ? (mark - stop) / mark : (stop - mark) / mark;
}
