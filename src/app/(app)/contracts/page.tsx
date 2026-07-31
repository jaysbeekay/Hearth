import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getUserPreferences } from "@/lib/userPreferences";
import { ContractListClient } from "@/components/ContractListClient";
import type { Prisma } from "@/generated/prisma/client";

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    status?: string;
    // Linked to from the dashboard's Needs Attention stat cards (#170) — not
    // exposed as filter-chip UI here, just accepted on arrival so those links
    // land on a genuinely pre-filtered list rather than the full one.
    expiring?: string;
    expired?: string;
  }>;
}) {
  const { q, category, status, expiring, expired } = await searchParams;

  const where: Prisma.ContractWhereInput = {};
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

  const [contracts, { dateFormat, region }, session] = await Promise.all([
    prisma.contract.findMany({
      where,
      include: { _count: { select: { documents: true } } },
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
      dateFormat={dateFormat}
      region={region}
      canWrite={session?.user.role !== "READONLY"}
    />
  );
}
