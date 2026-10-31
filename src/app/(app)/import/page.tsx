import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { prisma } from "@/lib/prisma";
import { ImportClient } from "@/components/ImportClient";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { BackLink } from "@/components/BackLink";

export const metadata: Metadata = { title: "Upload documents" };

export default async function ImportPage() {
  // Read-only members can't save documents (the save actions reject them),
  // so send them to Documents instead of a queue that can only fail.
  redirectIfReadOnly(await auth(), "/documents");

  const enabledModules = await getEnabledModuleKeys();

  const [properties, vehicles] = await Promise.all([
    enabledModules.has("HOME")
      ? prisma.property.findMany({ where: { deletedAt: null }, select: { id: true, label: true, archivedAt: true } })
      : [],
    enabledModules.has("VEHICLES")
      ? prisma.vehicle.findMany({ where: { deletedAt: null }, select: { id: true, label: true, archivedAt: true } })
      : [],
  ]);
  // #355 — late paperwork (a sale receipt, a final invoice) still files to an
  // Archived record, so it stays in the picker, labelled.
  const withArchivedLabel = (rows: { id: string; label: string; archivedAt: Date | null }[]) =>
    rows.map((row) => ({ id: row.id, label: row.archivedAt ? `${row.label} (archived)` : row.label }));

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink href="/documents" label="Documents" />
      <div>
        <h1 className="text-2xl font-medium">Upload documents</h1>
        <p className="text-sm text-muted">
          Drop in a document — or several at once if you&apos;re migrating existing paperwork.
          Hearth scans each one, you confirm what it is, review the details, and save.
        </p>
      </div>
      <ImportClient enabledModules={[...enabledModules]} properties={withArchivedLabel(properties)} vehicles={withArchivedLabel(vehicles)} />
    </div>
  );
}
