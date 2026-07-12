import type { Metadata } from "next";
import { ImportClient } from "@/components/ImportClient";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";

export const metadata: Metadata = { title: "Upload documents" };

export default async function ImportPage() {
  const enabledModules = await getEnabledModuleKeys();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Upload documents</h1>
        <p className="text-sm text-muted">
          Drop in a document — or several at once if you&apos;re migrating existing paperwork.
          Hearth scans each one, you confirm what it is, review the details, and save.
        </p>
      </div>
      <ImportClient enabledModules={[...enabledModules]} />
    </div>
  );
}
