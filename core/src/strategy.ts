import { atr, avgVolume, ema, highestHigh, lowestLow } from "./indicators.js";
import type { Candle, EntrySignal, ManageAction, Position, StrategyParams } from "./types.js";

export interface StrategyContext {
  coin: string;
  /** primary-interval candles, CLOSED only, ascending, last = most recent closed */
  candles: Candle[];
  /** context-interval candles, CLOSED only (closed at or before the last primary candle's close), ascending */
  context: Candle[];
  params: StrategyParams;
}

/** Number of primary candles the strategy needs to evaluate. */
export function requiredCandles(p: StrategyParams): number {
  return p.lookback + p.maxSetupBars + Math.max(p.volumeAvgN, p.atrN * 10, p.exitLookback) + 5;
}
export function requiredContext(p: StrategyParams): number {
  return Math.max(p.trendEmaN * 4, 60);
}

export type TrendBias = "up" | "down" | "flat";

/** Context trend from EMA of closes: up if close > ema and ema rising, down if below and falling. */
export function contextTrend(context: Candle[], n: number): { bias: TrendBias; strength: number } {
  if (context.length < n + 2) return { bias: "flat", strength: 0 };
  const closes = context.map((c) => c.c);
  const e = ema(closes, n);
  const last = closes[closes.length - 1];
  const eNow = e[e.length - 1];
  const ePrev = e[e.length - 4] ?? e[0];
  const strength = (last - eNow) / eNow;
  if (last > eNow && eNow >= ePrev) return { bias: "up", strength };
  if (last < eNow && eNow <= ePrev) return { bias: "down", strength };
  return { bias: "flat", strength };
}

function trendAllows(ctx: StrategyContext, side: "long" | "short"): boolean {
  const p = ctx.params;
  if (p.trendFilter === "none") return true;
  const { bias } = contextTrend(ctx.context, p.trendEmaN);
  return side === "long" ? bias === "up" : bias === "down";
}

/** Pure entry evaluation. Returns a signal for the LAST candle in ctx.candles or null. */
export function evaluateEntry(ctx: StrategyContext): EntrySignal | null {
  const p = ctx.params;
  if (ctx.candles.length < requiredCandles(p)) return null;
  if (p.name === "apex") return evaluateApex(ctx);
  return p.name === "donchian" ? evaluateDonchian(ctx) : evaluateReclaim(ctx);
}

/** Kaufman efficiency ratio of the last n closes: 1 = straight line, 0 = pure noise. */
export function efficiencyRatio(candles: Candle[], n: number): number {
  const i = candles.length - 1;
  if (i < n) return 0;
  const net = Math.abs(candles[i].c - candles[i - n].c);
  let path = 0;
  for (let k = i - n + 1; k <= i; k++) path += Math.abs(candles[k].c - candles[k - 1].c);
  return path > 0 ? net / path : 0;
}

/**
 * APEX: primary-interval channel breakout taken only in the direction of the context trend and only when the
 * context market is trending (efficiency ratio). No fixed target: the position is trailed (and pyramided) by manage().
 */
export function evaluateApex(ctx: StrategyContext): EntrySignal | null {
  const { candles, params: p, coin, context } = ctx;
  const i = candles.length - 1;
  const cur = candles[i];
  const a = atr(candles, p.atrN)[i];
  if (!(a > 0)) return null;
  if (p.regimeErMin > 0 && efficiencyRatio(context, p.regimeErN) < p.regimeErMin) return null;
  const vr = volumeRatio(candles, i, p.volumeAvgN);
  if (p.volumeMult > 0 && !(vr > p.volumeMult)) return null;
  const H = highestHigh(candles, i - p.lookback, i - 1);
  const L = lowestLow(candles, i - p.lookback, i - 1);
  const stopDist = p.stopAtrMult * a;
  if (p.allowLong && cur.c > H && candles[i - 1].c <= H && cur.c - H <= p.maxChaseAtr * a && trendAllows(ctx, "long")) {
    return { coin, side: "long", refPrice: cur.c, stopPrice: cur.c - stopDist, tpPrice: p.rMultiple > 0 ? cur.c + p.rMultiple * stopDist : null, atr: a, level: H, volumeRatio: vr, t: cur.t,
      reason: `apex long: ${p.lookback}-bar breakout ${fmt(cur.c)} > ${fmt(H)} with trend, ER ${efficiencyRatio(context, p.regimeErN).toFixed(2)}` };
  }
  if (p.allowShort && cur.c < L && candles[i - 1].c >= L && L - cur.c <= p.maxChaseAtr * a && trendAllows(ctx, "short")) {
    return { coin, side: "short", refPrice: cur.c, stopPrice: cur.c + stopDist, tpPrice: p.rMultiple > 0 ? cur.c - p.rMultiple * stopDist : null, atr: a, level: L, volumeRatio: vr, t: cur.t,
      reason: `apex short: ${p.lookback}-bar breakdown ${fmt(cur.c)} < ${fmt(L)} with trend, ER ${efficiencyRatio(context, p.regimeErN).toFixed(2)}` };
  }
  return null;
}

function volumeRatio(candles: Candle[], i: number, n: number): number {
  const avg = avgVolume(candles, i - n, i - 1);
  return avg > 0 ? candles[i].v / avg : 0;
}

/**
 * Volume-confirmed reclaim:
 *  1. candle b closed beyond the N-candle level (breakout),
 *  2. the previous candle (i-1) closed back at/inside the level (pullback),
 *  3. the current candle closes beyond the level again on volume > mult * avg (reclaim),
 *  4. the close is within maxChaseAtr ATR of the level (never chase).
 */
export function evaluateReclaim(ctx: StrategyContext): EntrySignal | null {
  const { candles, params: p, coin } = ctx;
  const i = candles.length - 1;
  const cur = candles[i];
  const atrArr = atr(candles, p.atrN);
  const a = atrArr[i];
  if (!(a > 0)) return null;
  const vr = volumeRatio(candles, i, p.volumeAvgN);
  if (!(vr > p.volumeMult)) return null;

  for (let b = i - 2; b >= i - p.maxSetupBars && b >= p.lookback; b--) {
    // LONG setup
    if (p.allowLong) {
      const H = highestHigh(candles, b - p.lookback, b - 1);
      if (candles[b].c > H && candles[i - 1].c <= H && cur.c > H && cur.c - H <= p.maxChaseAtr * a && trendAllows(ctx, "long")) {
        const pullbackLow = lowestLow(candles, b + 1, i);
        const stopDist = Math.min(Math.max(cur.c - pullbackLow, p.stopAtrMult * a), 3 * a);
        const stop = cur.c - stopDist;
        return {
          coin, side: "long", refPrice: cur.c, stopPrice: stop,
          tpPrice: p.rMultiple > 0 ? cur.c + p.rMultiple * stopDist : null,
          atr: a, level: H, volumeRatio: vr, t: cur.t,
          reason: `reclaim long: level ${fmt(H)} broke @b-${i - b}, pulled back, reclaimed on ${vr.toFixed(2)}x vol`,
        };
      }
    }
    // SHORT setup
    if (p.allowShort) {
      const L = lowestLow(candles, b - p.lookback, b - 1);
      if (candles[b].c < L && candles[i - 1].c >= L && cur.c < L && L - cur.c <= p.maxChaseAtr * a && trendAllows(ctx, "short")) {
        const pullbackHigh = highestHigh(candles, b + 1, i);
        const stopDist = Math.min(Math.max(pullbackHigh - cur.c, p.stopAtrMult * a), 3 * a);
        const stop = cur.c + stopDist;
        return {
          coin, side: "short", refPrice: cur.c, stopPrice: stop,
          tpPrice: p.rMultiple > 0 ? cur.c - p.rMultiple * stopDist : null,
          atr: a, level: L, volumeRatio: vr, t: cur.t,
          reason: `reclaim short: level ${fmt(L)} broke @b-${i - b}, pulled back, reclaimed on ${vr.toFixed(2)}x vol`,
        };
      }
    }
  }
  return null;
}

/**
 * Donchian trend breakout: close beyond the N-candle channel (optionally volume-confirmed),
 * ATR stop, exit on opposite exitLookback channel or trailing stop.
 */
export function evaluateDonchian(ctx: StrategyContext): EntrySignal | null {
  const { candles, params: p, coin } = ctx;
  const i = candles.length - 1;
  const cur = candles[i];
  const a = atr(candles, p.atrN)[i];
  if (!(a > 0)) return null;
  const vr = volumeRatio(candles, i, p.volumeAvgN);
  if (p.volumeMult > 0 && !(vr > p.volumeMult)) return null;
  const H = highestHigh(candles, i - p.lookback, i - 1);
  const L = lowestLow(candles, i - p.lookback, i - 1);
  const stopDist = p.stopAtrMult * a;
  if (p.allowLong && cur.c > H && candles[i - 1].c <= H && cur.c - H <= p.maxChaseAtr * a && trendAllows(ctx, "long")) {
    return {
      coin, side: "long", refPrice: cur.c, stopPrice: cur.c - stopDist,
      tpPrice: p.rMultiple > 0 ? cur.c + p.rMultiple * stopDist : null,
      atr: a, level: H, volumeRatio: vr, t: cur.t,
      reason: `donchian long: close ${fmt(cur.c)} > ${p.lookback}-bar high ${fmt(H)} (${vr.toFixed(2)}x vol)`,
    };
  }
  if (p.allowShort && cur.c < L && candles[i - 1].c >= L && L - cur.c <= p.maxChaseAtr * a && trendAllows(ctx, "short")) {
    return {
      coin, side: "short", refPrice: cur.c, stopPrice: cur.c + stopDist,
      tpPrice: p.rMultiple > 0 ? cur.c - p.rMultiple * stopDist : null,
      atr: a, level: L, volumeRatio: vr, t: cur.t,
      reason: `donchian short: close ${fmt(cur.c)} < ${p.lookback}-bar low ${fmt(L)} (${vr.toFixed(2)}x vol)`,
    };
  }
  return null;
}

/**
 * Position management on each closed candle: trailing stop (only tightens), time stop,
 * donchian channel exit. Pure: returns an action, never mutates.
 */
export function manage(ctx: StrategyContext, pos: Position): ManageAction | null {
  const { candles, params: p } = ctx;
  const i = candles.length - 1;
  if (i < 1) return null;
  const cur = candles[i];
  const action: ManageAction = {};
  const a = atr(candles, p.atrN)[i];
  const R = Math.abs(pos.entryPrice - pos.initialStop);

  if (p.timeStopBars > 0 && pos.barsHeld >= p.timeStopBars) {
    return { exit: { reason: `time stop after ${pos.barsHeld} bars` } };
  }
  if (p.name === "donchian" && p.exitLookback > 0 && i - p.exitLookback >= 0) {
    if (pos.side === "long" && cur.c < lowestLow(candles, i - p.exitLookback, i - 1)) return { exit: { reason: `channel exit: close below ${p.exitLookback}-bar low` } };
    if (pos.side === "short" && cur.c > highestHigh(candles, i - p.exitLookback, i - 1)) return { exit: { reason: `channel exit: close above ${p.exitLookback}-bar high` } };
  }
  if (p.trailAtrMult > 0 && a > 0 && R > 0) {
    const profitR = (pos.side === "long" ? cur.c - pos.entryPrice : pos.entryPrice - cur.c) / R;
    if (profitR >= p.trailAfterR) {
      const best = pos.side === "long" ? Math.max(pos.bestPrice, cur.h) : Math.min(pos.bestPrice, cur.l);
      const cand = pos.side === "long" ? best - p.trailAtrMult * a : best + p.trailAtrMult * a;
      const tighter = pos.side === "long" ? cand > pos.stopPrice : cand < pos.stopPrice;
      if (tighter) action.newStop = cand;
    }
  }
  // pyramiding: add a unit once price has moved addEveryAtr ATR beyond the last fill (trend still intact)
  if (p.maxUnits > 1 && pos.units < p.maxUnits && a > 0) {
    const moved = pos.side === "long" ? cur.c - pos.lastFillPrice : pos.lastFillPrice - cur.c;
    if (moved >= p.addEveryAtr * a && trendAllows(ctx, pos.side)) {
      const stopDist = p.stopAtrMult * a;
      action.addUnit = { refPrice: cur.c, stopPrice: pos.side === "long" ? cur.c - stopDist : cur.c + stopDist, atr: a };
    }
  }
  return action.newStop !== undefined || action.addUnit ? action : null;
}

/** Context candles closed at or before `closeTime` (no lookahead). */
export function contextUpTo(context: Candle[], intervalMs: number, closeTime: number): Candle[] {
  let lo = 0, hi = context.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (context[mid].t + intervalMs <= closeTime) lo = mid + 1; else hi = mid;
  }
  return context.slice(0, lo);
}

export const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
};

function fmt(x: number): string {
  return x >= 1000 ? x.toFixed(1) : x >= 10 ? x.toFixed(2) : x.toFixed(4);
}
