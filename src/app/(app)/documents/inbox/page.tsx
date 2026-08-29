import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getUserPreferences } from "@/lib/userPreferences";
import { getDocumentStats } from "@/lib/documents/stats";
import { findDocumentsByHashBatch, type DocumentKind } from "@/lib/documents/documentQueries";
import { InboxReviewClient, type DuplicateMatch } from "@/components/InboxReviewClient";
import { DocumentsTabs } from "@/components/DocumentsTabs";

export const metadata: Metadata = { title: "Inbox" };

// #252 — was an unbounded `findMany` with no `take`; every inbox document
// ever saved loaded on every page view regardless of how many were
// actually being reviewed right now.
const PAGE_SIZE = 25;

// Only these three kinds are ones the inbox can natively file into (matches
// classifyInboxDocument's boundary), so only they get a real link + an
// "attach as new version" action — a duplicate match in any other domain is
// still shown, just without an inline action (#206).
const OWNER_HREF: Partial<Record<DocumentKind, (ownerId: string) => string>> = {
  CONTRACT: (id) => `/contracts/${id}`,
  PRODUCT: (id) => `/products/${id}`,
  INVENTORY_ITEM: (id) => `/inventory/${id}`,
};

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(0, Number(pageParam) || 0);

  const [rows, enabledModules, { dateFormat }] = await Promise.all([
    prisma.inboxDocument.findMany({
      orderBy: { uploadedAt: "desc" },
      skip: page * PAGE_SIZE,
      take: PAGE_SIZE + 1, // +1 to detect a next page without a separate count()
    }),
    getEnabledModuleKeys(),
    getUserPreferences(),
  ]);
  const [properties, vehicles] = await Promise.all([
    enabledModules.has("HOME")
      ? prisma.property.findMany({ where: { deletedAt: null }, select: { id: true, label: true } })
      : [],
    enabledModules.has("VEHICLES")
      ? prisma.vehicle.findMany({ where: { deletedAt: null }, select: { id: true, label: true } })
      : [],
  ]);
  const hasMore = rows.length > PAGE_SIZE;
  const docs = rows.slice(0, PAGE_SIZE);

  const stats = await getDocumentStats(enabledModules);
  const filedCount = stats.total - stats.inboxCount;

  // Live-recomputed rather than trusting a stored reference — the matched
  // document may have been deleted since this row's status was set (#206).
  // Batched across every duplicate on this page in one pass per table
  // (9 queries total) instead of one findDocumentsByHash call per row.
  const duplicateHashes = docs
    .filter((d) => d.status === "POSSIBLE_DUPLICATE" && d.sha256)
    .map((d) => d.sha256!);
  const matchesByHash = await findDocumentsByHashBatch(duplicateHashes);

  const duplicatesByDoc = new Map<string, DuplicateMatch[]>();
  for (const doc of docs) {
    if (doc.status !== "POSSIBLE_DUPLICATE" || !doc.sha256) continue;
    const matches = matchesByHash.get(doc.sha256) ?? [];
    duplicatesByDoc.set(
      doc.id,
      matches.map((m) => ({
        kind: m.kind,
        filename: m.filename,
        ownerHref: m.ownerId && OWNER_HREF[m.kind] ? OWNER_HREF[m.kind]!(m.ownerId) : null,
        ownerId: m.ownerId,
        docId: m.id,
      })),
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Documents</h1>
        <p className="text-sm text-muted">
          Documents saved without picking a destination yet. Classify each one, or discard it.
        </p>
      </div>

      <DocumentsTabs
        active="inbox"
        inboxCount={stats.inboxCount}
        filedCount={filedCount}
        allCount={stats.total}
      />

      <InboxReviewClient
        docs={docs.map((d) => ({
          id: d.id,
          filename: d.filename,
          size: d.size,
          uploadedAt: d.uploadedAt.toISOString(),
          downloadHref: `/api/documents/inbox/${d.id}`,
          fromAddress: d.fromAddress,
          guessedType: d.guessedType,
          status: d.status,
          duplicateOf: duplicatesByDoc.get(d.id) ?? [],
        }))}
        dateFormat={dateFormat}
        inventoryEnabled={enabledModules.has("INVENTORY")}
        properties={properties}
        vehicles={vehicles}
      />

      {(page > 0 || hasMore) && (
        <div className="flex items-center justify-between border-t border-border pt-4">
          {page > 0 ? (
            <Link href={`/documents/inbox?page=${page - 1}`} className="text-sm text-accent hover:underline">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          {hasMore && (
            <Link href={`/documents/inbox?page=${page + 1}`} className="text-sm text-accent hover:underline">
              Older →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
