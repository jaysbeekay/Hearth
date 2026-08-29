import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getUserPreferences } from "@/lib/userPreferences";
import { ContractListClient } from "@/components/ContractListClient";
import type { Prisma } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Policies & contracts" };

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    status?: string;
    // expiring/expired are also linked to from the dashboard's Needs
    // Attention stat cards (#170); needsReview/missingDocument are new
    // filter-chip options (#207) surfaced directly on this page.
    expiring?: string;
    expired?: string;
    needsReview?: string;
    missingDocument?: string;
    // #328 — dashboard's "Contracts missing info" stat card deep-links here.
    missingInfo?: string;
  }>;
}) {
  const { q, category, status, expiring, expired, needsReview, missingDocument, missingInfo } =
    await searchParams;

  const where: Prisma.ContractWhereInput = { deletedAt: null };
  if (category) where.category = category as Prisma.ContractWhereInput["category"];
  if (status) where.status = status as Prisma.ContractWhereInput["status"];
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { provider: { contains: q } },
      { contractNumber: { contains: q } },
    ];
  }
  if (expired === "true") {
    where.endDate = { lt: new Date() };
  } else if (expiring) {
    const days = Number(expiring);
    if (Number.isFinite(days) && days > 0) {
      const until = new Date();
      until.setDate(until.getDate() + days);
      where.endDate = { gte: new Date(), lte: until };
    }
  }
  if (needsReview === "true") where.extractionPending = true;
  if (missingDocument === "true") where.documents = { none: {} };
  // Nested under `where.AND` (rather than `where.OR`, already used by `q`
  // above) so the two never collide. Deliberately narrower than the
  // Search API's full missingDate/missingReminder/missingRelationship/
  // missingIdentifier set: reminderDaysBefore defaults to a non-null value
  // and most contracts legitimately have no home/vehicle link, so folding
  // either into this aggregate would flag nearly everything — not
  // actionable. Only the two universally-relevant gaps count here.
  if (missingInfo === "true") {
    where.AND = [{ OR: [{ endDate: null }, { contractNumber: null }] }];
  }

  const [contracts, { dateFormat, region }, session] = await Promise.all([
    prisma.contract.findMany({
      where,
      include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
      orderBy: [{ status: "asc" }, { endDate: "asc" }],
    }),
    getUserPreferences(),
    auth(),
  ]);

  return (
    <ContractListClient
      contracts={contracts}
      q={q}
      category={category}
      status={status}
      expiring={expiring}
      expired={expired}
      needsReview={needsReview}
      missingDocument={missingDocument}
      dateFormat={dateFormat}
      region={region}
      canWrite={session?.user.role !== "READONLY"}
    />
  );
}
