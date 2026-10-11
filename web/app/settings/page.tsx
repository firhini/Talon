import { PageHeader } from "@/components/Header";
import SettingsForm from "@/components/SettingsForm";
import { getDb } from "@/lib/db";
import { liveChecklist } from "@/lib/effective";
import { settingsPayload } from "@/lib/payloads";
import { resolveMode } from "@/lib/state";
import { getSupervisor } from "@/lib/supervisor";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const db = getDb();
  const mode = resolveMode(db, (await searchParams).mode);
  const payload = settingsPayload();
  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-3 pb-24 sm:px-6">
      <PageHeader mode={mode} testnet={payload.testnet} active="settings" title="Settings" process={getSupervisor().process()} />
      <SettingsForm initial={payload} checklist={liveChecklist(db)} mode={mode} />
    </div>
  );
}
