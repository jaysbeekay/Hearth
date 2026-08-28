import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getUserPreferences } from "@/lib/userPreferences";
import { ProductListClient } from "@/components/ProductListClient";
import type { Prisma } from "@/generated/prisma/client";
import { isModuleEnabled } from "@/lib/modules/enablement";

export const metadata: Metadata = { title: "Purchases & warranties" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    expiring?: string;
    expired?: string;
    needsReview?: string;
    missingDocument?: string;
    // #328 — dashboard's "Warranties missing info" stat card deep-links here.
    missingInfo?: string;
  }>;
}) {
  const { q, expiring, expired, needsReview, missingDocument, missingInfo } = await searchParams;

  const where: Prisma.ProductWhereInput = { deletedAt: null };
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
  // Linked to from the dashboard's Needs Attention stat cards (#170).
  if (expired === "true") {
    where.warrantyEndDate = { lt: new Date() };
  } else if (expiring) {
    const days = Number(expiring);
    if (Number.isFinite(days) && days > 0) {
      const until = new Date();
      until.setDate(until.getDate() + days);
      where.warrantyEndDate = { gte: new Date(), lte: until };
    }
  }
  if (needsReview === "true") where.extractionPending = true;
  if (missingDocument === "true") where.documents = { none: {} };
  // Nested under `where.AND` (rather than `where.OR`, already used by `q`
  // above) so the two never collide. Deliberately narrower than the
  // Search API's full missingDate/missingReminder/missingRelationship/
  // missingIdentifier set — see the equivalent comment in contracts/page.tsx.
  if (missingInfo === "true") {
    where.AND = [{ OR: [{ warrantyEndDate: null }, { AND: [{ serialNumber: null }, { barcode: null }] }] }];
  }

  const [products, inventoryEnabled, { dateFormat, region }, session] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
      orderBy: [{ warrantyEndDate: "asc" }],
    }),
    isModuleEnabled("INVENTORY"),
    getUserPreferences(),
    auth(),
  ]);
  const inventoryItems = inventoryEnabled
    ? await prisma.inventoryItem.findMany({
        where: { deletedAt: null },
        include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
        orderBy: { updatedAt: "desc" },
      })
    : [];

  return (
    <ProductListClient
      products={products}
      inventoryItems={inventoryItems}
      inventoryEnabled={inventoryEnabled}
      q={q}
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
