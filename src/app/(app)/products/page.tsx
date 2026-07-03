import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { ProductListClient } from "@/components/ProductListClient";
import type { Prisma } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  const where: Prisma.ProductWhereInput = {};
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { manufacturer: { contains: q } },
      { vendor: { contains: q } },
      { serialNumber: { contains: q } },
      { barcode: { contains: q } },
    ];
  }

  const products = await prisma.product.findMany({
    where,
    orderBy: [{ warrantyEndDate: "asc" }],
  });

  return <ProductListClient products={products} q={q} />;
}
