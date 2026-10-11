import { feeCost, fundingPayment, grossPnl, isBuy, slippedPrice, type ApprovedOrder, type FeeConfig, type Position } from "@talon/core";
import type { Executor, Fill } from "./executor.js";

/** Simulated fills at the live mid price with configured slippage, taker fees and hourly funding. */
export class PaperExecutor implements Executor {
  readonly kind = "paper" as const;
  private position: Position | null = null;
  constructor(public cash: number, private readonly fees: FeeConfig, private readonly mark: () => number) {}

  setPosition(p: Position | null): void { this.position = p; }

  async equity(): Promise<number> {
    const p = this.position;
    if (!p) return this.cash;
    const m = this.mark();
    return this.cash + grossPnl(p.side, p.entryPrice, m, p.qty) - p.fees + p.funding;
  }

  async open(order: ApprovedOrder, mark: number, protect: (fillPx: number) => { stop: number; tp: number | null }): Promise<{ fill: Fill; stopOrderId: number | null; stop: number; tp: number | null }> {
    const price = slippedPrice(mark, isBuy(order.side, "open"), this.fees.slippageBps);
    const fee = feeCost(order.qty * price, this.fees.takerFeeBps);
    const { stop, tp } = protect(price);
    return { fill: { price, qty: order.qty, fee, time: Date.now() }, stopOrderId: null, stop, tp };
  }

  async updateStop(_pos: Position, _newStop: number): Promise<number | null> { return null; }

  /** Close at `mark` (stop/tp price or current mid) with slippage. */
  async close(pos: Position, mark: number, _reason: string): Promise<Fill> {
    const price = slippedPrice(mark, isBuy(pos.side, "close"), this.fees.slippageBps);
    const fee = feeCost(pos.qty * price, this.fees.takerFeeBps);
    const net = grossPnl(pos.side, pos.entryPrice, price, pos.qty) - pos.fees - fee + pos.funding;
    this.cash += net;
    this.position = null;
    return { price, qty: pos.qty, fee, time: Date.now() };
  }

  async flattenAll(): Promise<void> { /* engine closes the position via close() */ }

  /** Apply one hour of funding to the open position. */
  applyFunding(pos: Position, rate: number, mark: number): number {
    const pay = fundingPayment(pos.side, pos.qty * mark, rate);
    pos.funding += pay;
    return pay;
  }
}
