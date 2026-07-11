import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getUserPreferences } from "@/lib/userPreferences";
import { ContractListClient } from "@/components/ContractListClient";
import type { Prisma } from "@/generated/prisma/client";

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; status?: string }>;
}) {
  const { q, category, status } = await searchParams;

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

  const [contracts, { dateFormat }, session] = await Promise.all([
    prisma.contract.findMany({
      where,
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
      canWrite={session?.user.role !== "READONLY"}
    />
  );
}
