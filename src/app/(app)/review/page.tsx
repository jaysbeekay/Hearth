import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWrite as sessionCanWrite } from "@/lib/readOnly";
import { getPendingExtractionReview } from "@/lib/documents/extractionReview";
import { QuickCheckForm, type QuickCheckRecord } from "@/components/QuickCheckForm";
import { BackLink } from "@/components/BackLink";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = { title: "Quick check" };

// #358 — the one review screen: every Contract and Warranty saved with
// auto-filled details nobody has checked yet (Needs review), each editable
// inline, confirmed together. "Save all" on Upload lands here, and the
// dashboard's single Needs review row for several records links here.
export default async function QuickCheckPage({ searchParams }: { searchParams: Promise<{ added?: string }> }) {
  const canWrite = sessionCanWrite(await auth());
  const { added } = await searchParams;
  const addedCount = Number.parseInt(added ?? "", 10);

  const [contracts, products] = await Promise.all([
    prisma.contract.findMany({
      where: { extractionPending: true, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, provider: true },
    }),
    prisma.product.findMany({
      where: { extractionPending: true, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, description: true, manufacturer: true },
    }),
  ]);
  const records: QuickCheckRecord[] = [
    ...(await Promise.all(
      contracts.map(async (c) => ({
        kind: "CONTRACT" as const,
        id: c.id,
        title: c.title,
        subtitle: c.provider,
        href: `/contracts/${c.id}`,
        fields: await getPendingExtractionReview("CONTRACT", c.id),
      })),
    )),
    ...(await Promise.all(
      products.map(async (p) => ({
        kind: "PRODUCT" as const,
        id: p.id,
        title: p.description,
        subtitle: p.manufacturer ?? undefined,
        href: `/products/${p.id}`,
        fields: await getPendingExtractionReview("PRODUCT", p.id),
      })),
    )),
  ];

  const need = `${records.length} ${records.length === 1 ? "needs" : "need"} a quick check`;
  return (
    <PageShell width="detail">
      <BackLink href="/dashboard" label="Dashboard" />
      <div>
        <h1 className="text-2xl font-medium">Quick check</h1>
        <p className="text-sm text-muted">
          {Number.isFinite(addedCount) && addedCount > 0 && `${addedCount} ${addedCount === 1 ? "record" : "records"} added. `}
          {records.length === 0
            ? "Nothing needs a check."
            : Number.isFinite(addedCount) && addedCount > 0
              ? `${need}.`
              : `${records.length === 1 ? "1 record" : `${records.length} records`} with auto-filled details nobody has checked yet.`}{" "}
          {records.length > 0 && "Their reminders are on hold until they're confirmed."}
        </p>
      </div>
      {records.length > 0 && <QuickCheckForm records={records} canWrite={canWrite} />}
    </PageShell>
  );
}
