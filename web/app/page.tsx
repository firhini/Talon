import Dashboard from "@/components/Dashboard";
import { getDb } from "@/lib/db";
import { parseMode } from "@/lib/mode";
import { buildState } from "@/lib/state";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const mode = parseMode((await searchParams).mode);
  const state = buildState(getDb(), mode);
  return <Dashboard key={mode} initial={state} />;
}
