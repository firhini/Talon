import { formatScanTable, HL_MAINNET, HL_TESTNET, HyperliquidInfo, INTERVAL_MS, loadConfig, openDb, requiredCandles, requiredContext, saveScan, scanCoin, type ScanRow } from "@talon/core";
import { loadEnv } from "../env.js";

loadEnv();
const cfg = loadConfig();
const info = new HyperliquidInfo(cfg.live.testnet ? HL_TESTNET : HL_MAINNET);
const now = Date.now();
const ims = INTERVAL_MS[cfg.interval], cms = INTERVAL_MS[cfg.contextInterval];
const rows: ScanRow[] = [];
for (const coin of cfg.universe) {
  const [p, c] = await Promise.all([
    info.candles(coin, cfg.interval, now - (requiredCandles(cfg.strategy) + 20) * ims, now),
    info.candles(coin, cfg.contextInterval, now - (requiredContext(cfg.strategy) + 10) * cms, now),
  ]);
  rows.push(scanCoin(coin, p.filter((k) => k.t + ims <= now), c.filter((k) => k.t + cms <= now), cfg.strategy, now));
}
console.log(formatScanTable(rows));
const db = openDb(cfg.dbPath);
saveScan(db, cfg.mode, rows);
db.close();
