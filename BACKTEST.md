# Backtest report

Data: OKX USDT-perp candles (public API; Hyperliquid only serves the last ~5000 candles), **2025-09-01 → 2026-10-11** (13.3 months), BTC / ETH / SOL / BNB / HYPE, 15m + 1h + 4h. Funding: real hourly Hyperliquid funding history. Costs in every "with fees" number: taker 0.045 % per side, 3 bps slippage per side on entries, stops and take-profits (all are market orders live), funding. Entries fill at the next candle's open; inside a candle the stop is assumed to hit before the take-profit; gaps fill at the open. "No fees" is a separate run of the same strategy with zero fees, slippage and funding. Start equity $1 000, one position at a time, 5× leverage, non-compounding sizing. Reproduce with `npm run fetch-data -- --from 2025-09-01` and the commands shown below.

The period contains a full bear leg (BTC 114 k → 65 k) and a recovery, so both sides were tested.

## 1. The brief's strategy: 15m volume-confirmed breakout reclaim

`STRATEGY=reclaim npm run backtest` (lookback 48, volume > 1.5×, 1 ATR minimum stop, 3R target, 10 % size):

| | with fees | no fees |
|---|---:|---:|
| trades | 420 | 425 |
| win rate | 26.0 % | 27.8 % |
| expectancy (R) | −0.18 | 0.11 |
| profit factor | 0.95 | 1.24 |
| max drawdown | 21.3 % | 12.3 % |
| total return | **−6.0 %** | +28.9 % |
| fees paid | $168 | – |

The full grid (lookback 48/96, volume 1.5×/2×, stop 1/1.5 ATR, 2R/3R/trailing, with and without a 1h EMA trend filter, on 15m and on 1h) never produced an in-sample profit factor above 1.01 after fees, and every variant was negative out-of-sample. The raw signal has a real but small edge (+29 % without costs) that fees and slippage eat: at 15m the average winner is simply too small relative to the 0.15 % round-trip cost. **Verdict: do not trade it live.** It stays in the code base (`STRATEGY=reclaim`) and in the dashboard's backtest list for comparison.

## 2. What survived: 1h Donchian trend-following (the default)

`npm run backtest` — close beyond the 48-bar (2-day) channel, 2 ATR stop, 2R take-profit, exit on the opposite 24-bar channel, no volume or trend filter, long and short. Sizing: 10 % of equity margin at 5×, additionally capped so that a stop-out costs at most 1 % of equity (`RISK_PER_TRADE_PCT=0.01`). Kill switch 25 % drawdown, daily loss limit 5 %.

| | with fees | no fees |
|---|---:|---:|
| trades | 364 (199 long / 165 short) | 362 |
| win rate | 38.7 % | 39.5 % |
| expectancy (R) | 0.08 | 0.16 |
| expectancy ($) | 0.73 | 1.33 |
| profit factor | 1.15 | 1.29 |
| max drawdown | 18.0 % | 15.7 % |
| total return (13.3 mo) | **+26.7 %** | +48.3 % |
| Sharpe (daily) | 1.19 | 2.02 |
| fees / funding | $142 / −$5 | – |
| avg hold | 18.3 h | |
| exits | TP 128 · stop 187 · channel 49 | |
| kill switch / daily halts | none | |

Selection was done on the first 8 months only; the last 5 months are out-of-sample (`npm run backtest -- --sweep --grid "lookback=48" --validate-from 2026-05-01`, research mode without kill switch):

| | in-sample 2025-09 → 2026-04 | out-of-sample 2026-05 → 2026-10 |
|---|---:|---:|
| trades | 204 | 160 |
| win rate | 37 % | 41 % |
| expectancy (R) | 0.06 | 0.11 |
| profit factor | 1.10 | 1.22 |
| max drawdown | 17.2 % | 8.7 % |
| return | +10.4 % | +16.3 % |

Robustness checks:

* **Parameter neighbourhood** (lookback 36–72, stop 1.5–2.5 ATR, target 1.5–3 R, with/without volume filter: 96 variants): every variant has an in-sample profit factor ≥ 1.08 and 80 % are positive out-of-sample. The edge is a region, not a point.
* **Last 6 months only** (`--from 2026-04-11`): +12.1 %, PF 1.14, max DD 9.1 %.
* **Stress** (slippage 8 bps, taker 6 bps): +7.3 %, PF 1.04. Costs matter; keep the account on the base fee tier or better and trade only the liquid majors.
* **Concentration**: HYPE made $235 of the $267 net profit (BNB +55, BTC +21, SOL +14, ETH −57). That is what trend-following looks like: most of the return comes from the one or two assets that trend. Months were 9 positive / 5 negative; the worst month was −10 %.
* Sizing at the brief's 20 % margin (instead of 10 %) returns more (+45 %) but with a 22–30 % drawdown that trips a 15 % kill switch within three months; 10 % + the 1 % risk cap is what keeps the system inside its own kill switch.

## 3. Honest expectation

Expectancy of 0.08 R with a 39 % hit rate is a thin, real edge that depends on trends existing. A reasonable expectation is low-double-digit percent per year with drawdowns of 15–25 %, and quarters that lose money. Nothing here guarantees profit. Run paper mode first, compare the paper trade log with the backtest over a few weeks, and only then fund a small live account below `MAX_ACCOUNT_EQUITY`.
