import { candleRange, fetchOkxCandles, HyperliquidInfo, loadConfig, openDb, upsertCandles, upsertFunding, type Interval } from "@talon/core";
import { arg, loadEnv, parseDate } from "../env.js";

loadEnv();
const cfg = loadConfig();
const db = openDb(arg("db", cfg.dbPath)!);
const from = parseDate(arg("from"), Date.now() - 400 * 86_400_000);
const to = parseDate(arg("to"), Date.now());
const intervals = (arg("intervals", "15m,1h,4h") as string).split(",") as Interval[];
const coins = (arg("coins", cfg.universe.join(",")) as string).split(",");
const log = (s: string) => console.log(s);

log(`fetching ${coins.join(",")} ${intervals.join(",")} from ${new Date(from).toISOString().slice(0, 10)} to ${new Date(to).toISOString().slice(0, 10)}`);
for (const coin of coins) {
  for (const iv of intervals) {
    const have = candleRange(db, "okx", coin, iv);
    const start = have && have.min <= from + 86_400_000 ? have.max + 1 : from; // resume from what we have
    const candles = await fetchOkxCandles(coin, iv, start, to, log);
    upsertCandles(db, "okx", coin, iv, candles);
    const r = candleRange(db, "okx", coin, iv)!;
    log(`${coin} ${iv}: +${candles.length} → ${r.n} candles ${new Date(r.min).toISOString().slice(0, 10)}..${new Date(r.max).toISOString().slice(0, 10)}`);
  }
}
if (arg("funding", "yes") !== "no") {
  const hl = new HyperliquidInfo();
  for (const coin of coins) {
    const rows = await hl.fundingHistory(coin, from, to, log);
    upsertFunding(db, coin, rows);
    log(`${coin} funding: ${rows.length} hourly rows`);
  }
}
db.close();
log("done");
