import { HARD_MAX_LEVERAGE } from "./config.js";
import { clampStop, hardStopPrice, roundPrice, roundSize } from "./fees.js";
import type { AccountState, ApprovedOrder, AssetSpec, OrderIntent, Position, RiskConfig, Side } from "./types.js";

export type RiskDecision = { ok: true; order: ApprovedOrder } | { ok: false; reason: string };

/**
 * The single gate every order passes through. Executors accept only ApprovedOrder,
 * which is produced here and nowhere else.
 */
export class RiskGuard {
  constructor(public readonly cfg: RiskConfig, private readonly specs: Map<string, AssetSpec>) {
    if (cfg.maxLeverage > HARD_MAX_LEVERAGE) throw new Error(`maxLeverage ${cfg.maxLeverage} exceeds hard ceiling ${HARD_MAX_LEVERAGE}`);
    // isolated-margin liquidation sits near -50% ROE (maintenance = half the initial margin); the hard stop must come first
    if (cfg.hardStopRoe <= 0 || cfg.hardStopRoe > 0.45) throw new Error("hardStopRoe must be in (0, 0.45]");
  }

  spec(coin: string): AssetSpec | undefined {
    return this.specs.get(coin);
  }

  /** Account-level halt conditions. Returns a reason or null. */
  checkHalt(acct: AccountState): string | null {
    if (acct.halted) return acct.haltReason ?? "halted";
    if (acct.peakEquity > 0) {
      const dd = (acct.peakEquity - acct.equity) / acct.peakEquity;
      if (dd >= this.cfg.maxDrawdownPct) return `max drawdown ${(dd * 100).toFixed(2)}% >= ${(this.cfg.maxDrawdownPct * 100).toFixed(1)}%`;
    }
    if (acct.dayStartEquity > 0) {
      const dl = (acct.dayStartEquity - acct.equity) / acct.dayStartEquity;
      if (dl >= this.cfg.dailyLossLimitPct) return `daily loss ${(dl * 100).toFixed(2)}% >= ${(this.cfg.dailyLossLimitPct * 100).toFixed(1)}%`;
    }
    return null;
  }

  /**
   * Effective leverage for a coin: min of configured, hard ceiling and exchange max.
   * With dynamicLeverage and a known stop distance, the smallest leverage that still keeps the structural stop
   * inside the hard ROE stop is chosen (never more than the caps), so the stop is always hit before liquidation.
   */
  effectiveLeverage(coin: string, requested: number, stopFrac?: number): number {
    const spec = this.specs.get(coin);
    let lev = Math.min(requested, this.cfg.leverage, this.cfg.maxLeverage, HARD_MAX_LEVERAGE, spec?.maxLeverage ?? HARD_MAX_LEVERAGE);
    if (this.cfg.dynamicLeverage && stopFrac !== undefined && stopFrac > 0) lev = Math.min(lev, (this.cfg.hardStopRoe * 0.9) / stopFrac);
    return Math.max(1, Math.floor(lev));
  }

  /** Stop price clamped to the hard ROE stop and rounded to exchange precision. */
  finalStop(coin: string, side: Side, entry: number, structuralStop: number, leverage: number): number {
    const spec = this.specs.get(coin);
    const hard = hardStopPrice(side, entry, leverage, this.cfg.hardStopRoe);
    return roundPrice(clampStop(side, structuralStop, hard), spec?.szDecimals ?? 4);
  }

  approve(intent: OrderIntent, acct: AccountState): RiskDecision {
    const spec = this.specs.get(intent.coin);
    if (!spec) return { ok: false, reason: `unknown asset ${intent.coin}` };
    const halt = this.checkHalt(acct);
    if (halt) return { ok: false, reason: `halted: ${halt}` };
    if (acct.position) return { ok: false, reason: `already in ${acct.position.coin} ${acct.position.side}; one position at a time` };
    if (!(acct.equity > 0)) return { ok: false, reason: "no equity" };
    if (this.cfg.maxAccountEquity !== null && acct.equity > this.cfg.maxAccountEquity)
      return { ok: false, reason: `equity ${acct.equity.toFixed(2)} exceeds MAX_ACCOUNT_EQUITY ${this.cfg.maxAccountEquity}` };
    if (!(intent.refPrice > 0)) return { ok: false, reason: "invalid reference price" };
    if (!Number.isFinite(intent.stopPrice) || intent.stopPrice <= 0) return { ok: false, reason: "order has no stop" };
    if (intent.side === "long" ? intent.stopPrice >= intent.refPrice : intent.stopPrice <= intent.refPrice)
      return { ok: false, reason: "stop on wrong side of entry" };

    const stopFrac = Math.abs(intent.refPrice - intent.stopPrice) / intent.refPrice;
    const leverage = this.effectiveLeverage(intent.coin, intent.leverage, stopFrac);
    const sizingEquity = this.cfg.compound ? acct.equity : Math.min(this.cfg.baseEquity, acct.equity);
    let margin = sizingEquity * this.cfg.sizeFraction;
    margin = Math.min(margin, acct.equity * 0.95);
    let notionalWanted = margin * leverage;
    if (this.cfg.riskPerTradePct > 0 && stopFrac > 0) {
      // volatility-normalised cap: lose at most riskPerTradePct of equity if the structural stop is hit
      notionalWanted = Math.min(notionalWanted, (sizingEquity * this.cfg.riskPerTradePct) / stopFrac);
    }
    const qty = roundSize(notionalWanted / intent.refPrice, spec.szDecimals);
    const notional = qty * intent.refPrice;
    if (qty <= 0 || notional < this.cfg.minNotionalUsd)
      return { ok: false, reason: `order too small: notional ${notional.toFixed(2)} < min ${this.cfg.minNotionalUsd}` };

    const stopPrice = this.finalStop(intent.coin, intent.side, intent.refPrice, intent.stopPrice, leverage);
    if (intent.side === "long" ? stopPrice >= intent.refPrice : stopPrice <= intent.refPrice)
      return { ok: false, reason: "stop collapses onto entry after rounding" };
    const tpPrice = intent.tpPrice !== null ? roundPrice(intent.tpPrice, spec.szDecimals) : null;
    if (tpPrice !== null && (intent.side === "long" ? tpPrice <= intent.refPrice : tpPrice >= intent.refPrice))
      return { ok: false, reason: "take profit on wrong side of entry" };

    const order: ApprovedOrder = {
      __approved: true,
      coin: intent.coin, side: intent.side, qty, notional, margin: notional / leverage, leverage,
      stopPrice, tpPrice, refPrice: intent.refPrice, reason: intent.reason,
    };
    return { ok: true, order };
  }
}

/**
 * Pyramiding: approve one more unit for an existing position (same coin and side, same leverage, total margin capped).
 * Pass acct.equity = REALISED equity (without the open position's unrealised pnl): isolated margin cannot borrow against it.
 */
export function approveAdd(guard: RiskGuard, pos: Position, refPrice: number, stopPrice: number, acct: AccountState, reason: string): RiskDecision {
  const spec = guard.spec(pos.coin);
  if (!spec) return { ok: false, reason: `unknown asset ${pos.coin}` };
  const halt = guard.checkHalt(acct);
  if (halt) return { ok: false, reason: `halted: ${halt}` };
  if (!(refPrice > 0) || !Number.isFinite(stopPrice) || (pos.side === "long" ? stopPrice >= refPrice : stopPrice <= refPrice)) return { ok: false, reason: "add: stop on wrong side" };
  const cfg = guard.cfg;
  const stopFrac = Math.abs(refPrice - stopPrice) / refPrice;
  const sizingEquity = cfg.compound ? acct.equity : Math.min(cfg.baseEquity, acct.equity);
  const budget = Math.min(sizingEquity * cfg.sizeFraction, acct.equity * 0.95) - pos.margin; // remaining margin budget
  if (budget <= 0) return { ok: false, reason: "add: margin budget exhausted" };
  let notionalWanted = budget * pos.leverage;
  if (cfg.riskPerTradePct > 0 && stopFrac > 0) notionalWanted = Math.min(notionalWanted, (sizingEquity * cfg.riskPerTradePct) / stopFrac);
  // the new unit must survive the position's fixed leverage: its stop has to sit inside the hard ROE stop
  if (stopFrac > (cfg.hardStopRoe * 0.95) / pos.leverage) return { ok: false, reason: "add: stop outside hard ROE stop at current leverage" };
  const qty = roundSize(notionalWanted / refPrice, spec.szDecimals);
  const notional = qty * refPrice;
  if (qty <= 0 || notional < cfg.minNotionalUsd) return { ok: false, reason: `add too small: ${notional.toFixed(2)}` };
  const stop = roundPrice(stopPrice, spec.szDecimals);
  return { ok: true, order: { __approved: true, coin: pos.coin, side: pos.side, qty, notional, margin: notional / pos.leverage, leverage: pos.leverage, stopPrice: stop, tpPrice: pos.tpPrice, refPrice, reason } };
}

/** Start-of-day / peak bookkeeping shared by paper, live and backtest. */
export function rollAccountDay(acct: AccountState, equity: number, now: number, lastTs: number | null): AccountState {
  const day = (t: number) => Math.floor(t / 86_400_000);
  const next = { ...acct, equity };
  if (lastTs === null || day(now) !== day(lastTs)) {
    next.dayStartEquity = equity;
    next.dayPnl = 0;
  }
  if (equity > next.peakEquity) next.peakEquity = equity;
  return next;
}
