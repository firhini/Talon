import { EDITABLE_SETTINGS } from "@talon/core";
import { PageHeader } from "@/components/Header";
import StrategyLab from "@/components/StrategyLab";
import { getDb } from "@/lib/db";
import { effectiveConfig } from "@/lib/effective";
import { presetsPayload } from "@/lib/payloads";
import { resolveMode } from "@/lib/state";
import { getSupervisor } from "@/lib/supervisor";

export const dynamic = "force-dynamic";

export default async function StrategiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const db = getDb();
  const mode = resolveMode(db, (await searchParams).mode);
  const payload = presetsPayload();
  const cfg = effectiveConfig(db);
  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-3 pb-24 sm:px-6">
      <PageHeader mode={mode} testnet={cfg.testnet} active="strategies" title="Strategy lab" process={getSupervisor().process()} />
      <StrategyLab initial={payload} editable={EDITABLE_SETTINGS} effective={cfg.values} mode={mode} />
    </div>
  );
}
