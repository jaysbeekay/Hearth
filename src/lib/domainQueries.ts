// Shared read-only query/serialization logic for the household's non-contract
// domains (products, trips, vehicles, properties, inventory). Used by both
// the in-app AI Assistant (src/lib/chat/tools.ts) and the external MCP server
// (src/lib/mcp/server.ts) so the two tool layers don't re-derive the same
// Prisma queries independently. Net worth doesn't need an entry here — it
// already has a single shared implementation in src/lib/wealth.ts.
import { prisma } from "@/lib/prisma";
import { daysUntil, formatPropertyAddress } from "@/lib/utils";

export function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export async function queryProducts(query?: string) {
  const products = await prisma.product.findMany({
    where: {
      deletedAt: null,
      ...(query
        ? {
            OR: [
              { description: { contains: query } },
              { manufacturer: { contains: query } },
              { model: { contains: query } },
              { vendor: { contains: query } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      description: true,
      manufacturer: true,
      model: true,
      vendor: true,
      purchaseDate: true,
      warrantyEndDate: true,
      price: true,
      currency: true,
      notes: true,
    },
    orderBy: { warrantyEndDate: "asc" },
  });
  return products.map((p) => ({
    ...p,
    purchaseDate: iso(p.purchaseDate),
    warrantyEndDate: iso(p.warrantyEndDate),
    daysUntilWarrantyEnd: daysUntil(p.warrantyEndDate),
  }));
}

export async function queryTrips(upcomingOnly?: boolean) {
  const trips = await prisma.trip.findMany({
    where: {
      deletedAt: null,
      ...(upcomingOnly ? { OR: [{ endDate: null }, { endDate: { gte: new Date() } }] } : {}),
    },
    select: {
      id: true,
      title: true,
      destination: true,
      startDate: true,
      endDate: true,
      notes: true,
      _count: { select: { segments: true } },
    },
    orderBy: { startDate: "asc" },
  });
  return trips.map((t) => ({
    id: t.id,
    title: t.title,
    destination: t.destination,
    startDate: iso(t.startDate),
    endDate: iso(t.endDate),
    notes: t.notes,
    segmentCount: t._count.segments,
  }));
}

export async function queryVehicles(attentionOnly?: boolean) {
  const vehicles = await prisma.vehicle.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      label: true,
      make: true,
      model: true,
      year: true,
      licensePlate: true,
      regoExpiry: true,
      insuranceExpiry: true,
      nextServiceDue: true,
      notes: true,
    },
  });
  const withDays = vehicles.map((v) => ({
    ...v,
    regoExpiry: iso(v.regoExpiry),
    insuranceExpiry: iso(v.insuranceExpiry),
    nextServiceDue: iso(v.nextServiceDue),
    daysUntilRegoExpiry: daysUntil(v.regoExpiry),
    daysUntilInsuranceExpiry: daysUntil(v.insuranceExpiry),
    daysUntilNextServiceDue: daysUntil(v.nextServiceDue),
  }));
  if (!attentionOnly) return withDays;
  const needsAttention = (days: number | null) => days != null && days <= 30;
  return withDays.filter(
    (v) => needsAttention(v.daysUntilRegoExpiry) || needsAttention(v.daysUntilInsuranceExpiry),
  );
}

export async function queryProperties() {
  const properties = await prisma.property.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      label: true,
      street: true,
      suburb: true,
      state: true,
      postcode: true,
      country: true,
      isRented: true,
      occupancyStatus: true,
      notes: true,
      rentalAgreements: {
        select: { tenantName: true, weeklyRent: true, leaseEnd: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      valuations: {
        select: { value: true, currency: true, valuedAt: true },
        orderBy: { valuedAt: "desc" },
        take: 1,
      },
    },
  });
  return properties.map((p) => ({
    id: p.id,
    label: p.label,
    address: formatPropertyAddress(p) || null,
    isRented: p.isRented,
    occupancyStatus: p.occupancyStatus,
    notes: p.notes,
    currentTenant: p.rentalAgreements[0]
      ? {
          tenantName: p.rentalAgreements[0].tenantName,
          weeklyRent: p.rentalAgreements[0].weeklyRent,
          leaseEnd: iso(p.rentalAgreements[0].leaseEnd),
        }
      : null,
    latestValuation: p.valuations[0]
      ? {
          value: p.valuations[0].value,
          currency: p.valuations[0].currency,
          valuedAt: iso(p.valuations[0].valuedAt),
        }
      : null,
  }));
}

export async function queryInventoryItems(query?: string) {
  const items = await prisma.inventoryItem.findMany({
    where: {
      deletedAt: null,
      ...(query
        ? {
            OR: [
              { label: { contains: query } },
              { brand: { contains: query } },
              { model: { contains: query } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      label: true,
      category: true,
      brand: true,
      model: true,
      purchaseDate: true,
      purchasePrice: true,
      currency: true,
      location: true,
      notes: true,
    },
  });
  return items.map((i) => ({ ...i, purchaseDate: iso(i.purchaseDate) }));
}
