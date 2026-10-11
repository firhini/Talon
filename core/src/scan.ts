import { atr, avgVolume, highestHigh, lowestLow } from "./indicators.js";
import { contextTrend, evaluateEntry, type StrategyContext } from "./strategy.js";
import type { Candle, ScanRow, StrategyParams } from "./types.js";

/** Per-coin market read: trend, volatility, volume activity, distance to breakout levels, current setup state. */
export function scanCoin(coin: string, candles: Candle[], context: Candle[], p: StrategyParams, t: number = candles[candles.length - 1]?.t ?? 0): ScanRow {
  const i = candles.length - 1;
  const price = candles[i].c;
  const a = atr(candles, p.atrN)[i];
  const atrPct = a > 0 ? a / price : 0;
  const recentVol = avgVolume(candles, i - p.volumeAvgN + 1, i);
  const baseVol = avgVolume(candles, i - p.volumeAvgN * 5 + 1, i - p.volumeAvgN);
  const volumeRatio = baseVol > 0 ? recentVol / baseVol : 0;
  const levelHigh = highestHigh(candles, i - p.lookback + 1, i);
  const levelLow = lowestLow(candles, i - p.lookback + 1, i);
  const distHighPct = (levelHigh - price) / price;
  const distLowPct = (price - levelLow) / price;
  const { bias, strength } = contextTrend(context, p.trendEmaN);
  const regime = atrPct > 0.012 ? `high-vol ${bias}` : bias === "flat" ? "ranging" : `trending ${bias}`;

  let setup = "none";
  const ctx: StrategyContext = { coin, candles, context, params: p };
  const sig = evaluateEntry(ctx);
  if (sig) setup = `SIGNAL ${sig.side}`;
  else {
    for (let b = i; b >= i - p.maxSetupBars && b > p.lookback; b--) {
      const H = highestHigh(candles, b - p.lookback, b - 1);
      const L = lowestLow(candles, b - p.lookback, b - 1);
      if (candles[b].c > H) { setup = candles[i].c <= H ? "pullback after upside break" : "broke above, waiting for pullback"; break; }
      if (candles[b].c < L) { setup = candles[i].c >= L ? "pullback after downside break" : "broke below, waiting for pullback"; break; }
    }
    if (setup === "none") {
      if (distHighPct < atrPct) setup = "near breakout high";
      else if (distLowPct < atrPct) setup = "near breakout low";
    }
  }
  return { t, coin, price, trend: bias, trendStrength: strength, atrPct, volumeRatio, levelHigh, levelLow, distHighPct, distLowPct, regime, setup };
}

export function formatScanTable(rows: ScanRow[]): string {
  const pct = (x: number) => (x * 100).toFixed(2) + "%";
  const lines = ["coin  price        trend  str%    atr%   vol    hi-level     dist    lo-level     dist    regime            setup"];
  for (const r of rows) {
    lines.push(`${r.coin.padEnd(5)} ${r.price.toFixed(r.price < 10 ? 4 : 2).padStart(11)}  ${r.trend.padEnd(5)}  ${pct(r.trendStrength).padStart(7)} ${pct(r.atrPct).padStart(6)}  ${r.volumeRatio.toFixed(2).padStart(5)}  ${r.levelHigh.toFixed(2).padStart(10)}  ${pct(r.distHighPct).padStart(7)} ${r.levelLow.toFixed(2).padStart(10)}  ${pct(r.distLowPct).padStart(7)}  ${r.regime.padEnd(17)} ${r.setup}`);
  }
  return lines.join("\n");
}
