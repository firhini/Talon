import Dashboard from "@/components/Dashboard";
import { getDb } from "@/lib/db";
import { buildState, resolveMode } from "@/lib/state";
import { getTicker } from "@/lib/ticker";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const db = getDb();
  const mode = resolveMode(db, (await searchParams).mode);
  const state = buildState(db, mode);
  // first paint carries the cached ticker when one exists; otherwise the client fetches it
  const ticker = await Promise.race([getTicker(state.universe), new Promise<null>((r) => setTimeout(() => r(null), 1500))]).catch(() => null);
  return <Dashboard key={mode} initial={state} ticker={ticker} />;
}
