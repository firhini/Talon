import { describe, expect, it } from "vitest";
import { monteCarlo } from "../src/montecarlo.js";
import type { Trade } from "../src/types.js";

const mk = (pnls: number[]): Trade[] => pnls.map((pnl, i) => ({ mode: "backtest", runId: "t", coin: "BTC", side: "long", leverage: 5, qty: 1, entryPrice: 100, entryTime: i, exitPrice: 100, exitTime: i + 1, stopPrice: 99, tpPrice: null, grossPnl: pnl, fees: 0, funding: 0, pnl, roe: 0, reasonEntry: "", reasonExit: "", units: 1, equityBefore: 1000 }));

describe("monte carlo", () => {
  it("needs at least 20 trades", () => {
    expect(monteCarlo(mk([1, 2, 3]), 1000)).toBeNull();
  });
  it("is deterministic and reflects the edge", () => {
    const good = mk(Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? -20 : 15)));
    const a = monteCarlo(good, 1000, 500), b = monteCarlo(good, 1000, 500);
    expect(a).toEqual(b);
    expect(a!.p50).toBeGreaterThan(1);
    expect(a!.p5).toBeLessThan(a!.p95);
    const bad = mk(Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? 20 : -15)));
    expect(monteCarlo(bad, 1000, 500)!.p50).toBeLessThan(1);
  });
  it("flags ruin when single trades can wipe the account", () => {
    const wild = mk(Array.from({ length: 40 }, (_, i) => (i % 2 ? 600 : -950)));
    const r = monteCarlo(wild, 1000, 500)!;
    expect(r.pDd90).toBeGreaterThan(0.5);
  });
});
