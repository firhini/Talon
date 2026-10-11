import { PageHeader } from "@/components/Header";
import SystemPanel from "@/components/SystemPanel";
import { getDb } from "@/lib/db";
import { effectiveConfig } from "@/lib/effective";
import { systemPayload } from "@/lib/payloads";
import { resolveMode } from "@/lib/state";

export const dynamic = "force-dynamic";

export default async function SystemPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const db = getDb();
  const mode = resolveMode(db, (await searchParams).mode);
  const payload = systemPayload(200);
  const cfg = effectiveConfig(db);
  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-3 pb-24 sm:px-6">
      <PageHeader mode={mode} testnet={cfg.testnet} active="system" title="System" process={payload.process} />
      <SystemPanel initial={payload} mode={mode} />
    </div>
  );
}
