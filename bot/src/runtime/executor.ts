import { fmtNum, roundPrice, type ApprovedOrder, type AssetSpec, type Position, type Side } from "@talon/core";

export interface Fill {
  price: number;
  qty: number;
  fee: number;
  time: number;
}

/** Everything that touches money goes through this interface; it accepts ONLY RiskGuard-approved orders. */
export interface Executor {
  readonly kind: "paper" | "live";
  /** account equity incl. unrealized pnl */
  equity(): Promise<number>;
  /** open at market; `protect(fillPx)` yields the final stop/tp for the actual fill, which live mode places as real orders before returning */
  open(order: ApprovedOrder, mark: number, protect: (fillPx: number) => { stop: number; tp: number | null }): Promise<{ fill: Fill; stopOrderId: number | null; stop: number; tp: number | null }>;
  /** replace the protective stop (and keep TP) */
  updateStop(pos: Position, newStop: number): Promise<number | null>;
  close(pos: Position, mark: number, reason: string): Promise<Fill>;
  /** flatten everything, cancel all orders (kill switch) */
  flattenAll(reason: string): Promise<void>;
}

// ---------- pure order builders (unit-tested) ----------
export type HlOrder = {
  a: number; b: boolean; p: string; s: string; r: boolean;
  t: { limit: { tif: "Ioc" | "Gtc" | "Alo" } } | { trigger: { isMarket: boolean; triggerPx: string; tpsl: "sl" | "tp" } };
  c?: `0x${string}`;
};

/** Marketable IOC limit: crosses the book but caps slippage. */
export function buildEntryOrder(spec: AssetSpec, side: Side, qty: number, mark: number, maxSlipPct = 0.005): HlOrder {
  const isBuy = side === "long";
  const px = roundPrice(isBuy ? mark * (1 + maxSlipPct) : mark * (1 - maxSlipPct), spec.szDecimals);
  return { a: spec.assetIndex, b: isBuy, p: fmtNum(px), s: fmtNum(qty), r: false, t: { limit: { tif: "Ioc" } } };
}

/** Reduce-only stop-market (and optional take-profit) protecting a position. */
export function buildProtectiveOrders(spec: AssetSpec, side: Side, qty: number, stopPx: number, tpPx: number | null, slipBand = 0.03): HlOrder[] {
  const closeIsBuy = side === "short";
  const stopLimit = roundPrice(closeIsBuy ? stopPx * (1 + slipBand) : stopPx * (1 - slipBand), spec.szDecimals);
  const out: HlOrder[] = [{
    a: spec.assetIndex, b: closeIsBuy, p: fmtNum(stopLimit), s: fmtNum(qty), r: true,
    t: { trigger: { isMarket: true, triggerPx: fmtNum(roundPrice(stopPx, spec.szDecimals)), tpsl: "sl" } },
  }];
  if (tpPx !== null) {
    const tpLimit = roundPrice(closeIsBuy ? tpPx * (1 + slipBand) : tpPx * (1 - slipBand), spec.szDecimals);
    out.push({
      a: spec.assetIndex, b: closeIsBuy, p: fmtNum(tpLimit), s: fmtNum(qty), r: true,
      t: { trigger: { isMarket: true, triggerPx: fmtNum(roundPrice(tpPx, spec.szDecimals)), tpsl: "tp" } },
    });
  }
  return out;
}

export function buildCloseOrder(spec: AssetSpec, side: Side, qty: number, mark: number, maxSlipPct = 0.01): HlOrder {
  const isBuy = side === "short";
  const px = roundPrice(isBuy ? mark * (1 + maxSlipPct) : mark * (1 - maxSlipPct), spec.szDecimals);
  return { a: spec.assetIndex, b: isBuy, p: fmtNum(px), s: fmtNum(qty), r: true, t: { limit: { tif: "Ioc" } } };
}
