import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getUserPreferences } from "@/lib/userPreferences";
import { ProductListClient } from "@/components/ProductListClient";
import type { Prisma } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Warranties" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  const where: Prisma.ProductWhereInput = {};
  if (q) {
    where.OR = [
      { description: { contains: q } },
      { manufacturer: { contains: q } },
      { model: { contains: q } },
      { vendor: { contains: q } },
      { serialNumber: { contains: q } },
      { barcode: { contains: q } },
    ];
  }

  const [products, { dateFormat, region }, session] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { _count: { select: { documents: true } } },
      orderBy: [{ warrantyEndDate: "asc" }],
    }),
    getUserPreferences(),
    auth(),
  ]);

  return (
    <ProductListClient
      products={products}
      q={q}
      dateFormat={dateFormat}
      region={region}
      canWrite={session?.user.role !== "READONLY"}
    />
  );
}
