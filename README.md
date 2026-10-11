# TALON — Hyperliquid perps trading agent

Node worker (`bot/`) + Next.js dashboard (`web/`) sharing one SQLite database, with a pure, unit-tested strategy module and a single `RiskGuard` that every order has to pass. TypeScript throughout.

```
core/   @talon/core  strategy · RiskGuard · fee/funding/slippage math · backtester · market scan · SQLite · data sources
bot/    @talon/bot   long-running worker (paper / live), CLIs: fetch-data, backtest, scan
web/    @talon/web   dashboard (equity curve, position, scan table, trade log, backtest reports, controls)
```

Modes (`MODE` env): `backtest` | `paper` (default) | `live`. The same strategy and RiskGuard code runs in all three; only the executor differs.

> **Reality check.** No strategy is guaranteed to make money. The backtests in [`BACKTEST.md`](BACKTEST.md) are honest: they include taker fees, slippage and real funding history and are split into in-sample and out-of-sample periods. The brief's 15m reclaim strategy **loses after fees** (−6.0 % over 13 months); the default therefore is a 1h Donchian trend-following variant that was profitable in both periods (+26.7 %, max drawdown 18.0 %, profit factor 1.15) — a thin edge that needs trends. Read the report before you risk anything. Start in paper mode.

---

## 1. Setup

Requirements: Node 22.12+ (the Hyperliquid SDK needs it), npm 10.

```bash
git clone <this repo> && cd Talon
cp .env.example .env            # edit as needed; defaults are paper mode
npm install                     # installs all workspaces (better-sqlite3 ships prebuilt binaries)
npm run build:core              # compile @talon/core (bot and web import the compiled package)
npm test                        # strategy, RiskGuard, fee/funding math, backtester, order builders
```

All settings live in `.env` (see `.env.example`, every key is documented there). Secrets are only ever read from the environment; nothing is written to the DB or logs (anything that looks like a private key is redacted from log lines).

## 2. Run each mode

### Backtest (do this first)

```bash
npm run fetch-data -- --from 2025-09-01        # 15m/1h/4h candles from OKX (public, no key) + Hyperliquid funding history
npm run backtest                               # strategy from .env, prints the report, saves it (dashboard → /backtests)
npm run backtest -- --trades                   # also prints every trade
npm run backtest -- --sweep --validate-from 2026-05-01   # parameter grid with in-sample / out-of-sample split
```

Why OKX for history: Hyperliquid's public candle endpoint only returns the most recent ~5000 candles (≈52 days of 15m), which is not enough for a 6-month backtest. Prices of the five majors track across venues to within slippage; funding comes from Hyperliquid itself.

### Paper

```bash
MODE=paper npm run bot        # or set MODE in .env
npm run web                   # dashboard on http://localhost:3000
```

Paper mode polls Hyperliquid's public API (mid prices every 15 s, candles at every 15m close), fills at mid ± slippage, charges taker fees and applies the real hourly funding rate while a position is open. Stops and take-profits trigger on mid price. State is persisted; restarting resumes the open position.

### Live

The bot refuses to start live unless **all** of the following are set:

```
MODE=live
LIVE_CONFIRM=yes
MAX_ACCOUNT_EQUITY=500        # it refuses to trade an account holding more than this
HL_ACCOUNT_ADDRESS=0x…        # your master account
HL_PRIVATE_KEY=0x…            # the API wallet key (trading-only), never your main key
```

Then `npm run bot`. At start the bot checks that the key really is an authorised API wallet of `HL_ACCOUNT_ADDRESS` (Hyperliquid's `extraAgents` list) and that the account is below `MAX_ACCOUNT_EQUITY`. In live mode every entry is a marketable IOC order and, before the call returns, a **reduce-only stop-market order** is resting on the exchange (the take-profit trigger is placed right after, best-effort). If the stop cannot be placed the position is closed immediately. Closes are IOC orders retried with a widening price band; the stop is cancelled only once the exchange shows the position flat. On every tick the bot reconciles with the exchange: a stop/TP fill is recorded from your fills (funding from your funding history), a missing stop is re-placed at the tracked stop price, and an unknown position in the universe is adopted and protected with the hard ROE stop. A failed kill-switch flatten is retried every tick until it succeeds.

Dashboard buttons: **Start** / **Pause** (no new entries, open position still managed) / **Kill switch** (flatten everything, cancel all orders, halt) / **Reset** (clear a halt; baselines reset; bot stays paused until you press Start). A halt from the daily-loss limit or max-drawdown switch survives restarts: the bot comes back halted until you reset it.

### How to create a Hyperliquid API wallet with trading-only permissions

1. Open https://app.hyperliquid.xyz, connect the wallet that holds your trading funds (this is `HL_ACCOUNT_ADDRESS`). Deposit the small amount you are willing to trade.
2. Go to **More → API** (https://app.hyperliquid.xyz/API).
3. Click **Generate**, give the agent a name (e.g. `talon`), choose the validity period (max 180 days) and click **Authorize API Wallet**; sign the authorization with your main wallet.
4. Copy the **private key shown once** into `HL_PRIVATE_KEY`. This "agent" wallet can only sign trading actions (orders, cancels, leverage) for your account — it cannot withdraw or transfer funds. You can revoke it on the same page at any time.
5. For a dry run on testnet: https://app.hyperliquid-testnet.xyz (faucet in the menu), same steps, and set `HL_TESTNET=true`.
6. Keep `MAX_ACCOUNT_EQUITY` at the amount you can afford to lose; TALON refuses to start if the account holds more.

API wallets expire; when yours does, orders fail with a signature error — generate a new one.

## 3. Strategy

Universe BTC, ETH, SOL, BNB, HYPE; `CANDLE_INTERVAL` with one-step-higher `CONTEXT_INTERVAL` (1h/4h for the default, 15m/1h for the reclaim preset). One position at a time across the universe (when several coins signal on the same candle the strongest volume confirmation wins). Two pure strategy variants share the same interface (`core/src/strategy.ts`); `STRATEGY=` selects the preset and every parameter can be overridden in `.env`:

* **`donchian`** (default): classic channel breakout trend-following — close beyond the `LOOKBACK`-bar (48 h) channel, 2 ATR stop, 2R take-profit, exit on the opposite `EXIT_LOOKBACK` channel, long and short, no filters. Chosen because it is the configuration that made money in-sample *and* out-of-sample; see `BACKTEST.md` for the grid, the neighbourhood test and the stress test.
* **`reclaim`** (the brief): breakout level = highest high / lowest low of the previous `LOOKBACK` candles. A candle closes beyond the level (break), a later candle closes back inside (pullback), and the entry fires only when the next candle closes beyond the level again **on volume > `VOLUME_MULT` × the 20-candle average** and within `MAX_CHASE_ATR` ATR of the level. No confirmation → no trade, never chase. Stop = pullback extreme, widened to at least `STOP_ATR_MULT` ATR; take-profit at `R_MULTIPLE` × risk; optional ATR trailing stop.
Optional 1h EMA trend filter (`TREND_FILTER=ema`): longs only above a rising EMA, shorts only below a falling one.

Startup: a market scan (trend, ATR %, volume activity, distance to the breakout levels, current setup state) is computed for all five coins, stored and shown on the dashboard before any trade, and refreshed every candle.

## 4. Risk (RiskGuard — `core/src/risk.ts`)

Every order intent is turned into an `ApprovedOrder` by `RiskGuard.approve()` or rejected with a reason. The executors accept only `ApprovedOrder`s. It enforces:

* leverage = min(`LEVERAGE`, `MAX_LEVERAGE`, exchange max, **hard ceiling 10× in code**)
* margin per trade = `SIZE_FRACTION` × equity (starting equity unless `COMPOUND=true`); never all-in. Default 10 % (the brief's 20 % trips the kill switch in backtests). `RISK_PER_TRADE_PCT` additionally caps the size so a stop-out costs at most 1 % of equity (volatility-normalised: wider stop → smaller position)
* a stop must exist on the correct side; it is clamped to the **−40 % ROE hard stop** (`HARD_STOP_ROE`) and placed as a real exchange order in live mode
* Hyperliquid tick/lot rounding (5 significant figures, `szDecimals`) and the $10 minimum order; trades that round to nothing are skipped
* daily-loss limit and max-drawdown **kill switch**: flatten, cancel, halt until manual reset
* one position at a time; live: `MAX_ACCOUNT_EQUITY` cap

## 5. Realism

Paper and backtest charge the taker fee (`TAKER_FEE_BPS`, Hyperliquid base tier 0.045 %) on entry and exit, slippage per side (`SLIPPAGE_BPS`), and hourly funding (real history in backtests, the live rate in paper). The backtester fills entries at the next candle's open, assumes the stop is hit before the take-profit when both fall inside one candle, fills gaps at the open, and reports every metric with and without fees. Every trade is logged with time, coin, side, leverage, entry, exit, ROE, PnL, fees, funding and entry/exit reasons.

## 6. Dashboard

`npm run web` → http://localhost:3000 — current mode (PAPER / LIVE) front and centre, equity curve, open position with live ROE and stop distance, market scan table, trade log, event feed, start / pause / kill-switch / reset buttons, and `/backtests` with the saved reports (metrics with vs. without fees, equity curves, trades). It reads the same SQLite file (`DB_PATH`) the bot writes. Run it on the VPS behind your own auth/VPN; it has none.

## 7. Tests

```bash
npm test
```

`core/test/*`: strategy (reclaim and donchian signals, never-chase, volume gate, trend filter, trailing/time stops, no-lookahead context), RiskGuard (leverage ceiling, sizing, stop clamp, min notional, halts, equity cap), fee/funding/slippage/rounding math, backtester fills and kill switch. `bot/test/*`: Hyperliquid order construction (IOC entry, reduce-only stop/TP triggers, close).
