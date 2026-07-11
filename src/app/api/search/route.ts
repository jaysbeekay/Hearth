import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";

export interface SearchResult {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  group: string;
}

const LIMIT = 8;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ groups: {} });
  }

  const enabledModules = await getEnabledModuleKeys();
  const contains = { contains: q };
  const queries: Promise<SearchResult[]>[] = [];

  queries.push(
    prisma.contract
      .findMany({
        where: {
          OR: [
            { title: contains },
            { provider: contains },
            { documents: { some: { extractedText: contains } } },
          ],
        },
        select: { id: true, title: true, provider: true },
        take: LIMIT,
      })
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          subtitle: r.provider,
          href: `/contracts/${r.id}`,
          group: "Contracts",
        })),
      ),
  );

  queries.push(
    prisma.product
      .findMany({
        where: {
          OR: [
            { name: contains },
            { manufacturer: contains },
            { vendor: contains },
            { documents: { some: { extractedText: contains } } },
          ],
        },
        select: { id: true, name: true, manufacturer: true },
        take: LIMIT,
      })
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          title: r.name,
          subtitle: r.manufacturer ?? undefined,
          href: `/products/${r.id}`,
          group: "Products",
        })),
      ),
  );

  queries.push(
    prisma.document
      .findMany({
        where: { OR: [{ filename: contains }, { extractedText: contains }] },
        select: { id: true, filename: true, contract: { select: { id: true, title: true } } },
        take: LIMIT,
      })
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          title: r.filename,
          subtitle: r.contract.title,
          href: `/contracts/${r.contract.id}`,
          group: "Documents",
        })),
      ),
  );

  queries.push(
    prisma.productDocument
      .findMany({
        where: { OR: [{ filename: contains }, { extractedText: contains }] },
        select: { id: true, filename: true, product: { select: { id: true, name: true } } },
        take: LIMIT,
      })
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          title: r.filename,
          subtitle: r.product.name,
          href: `/products/${r.product.id}`,
          group: "Documents",
        })),
      ),
  );

  if (enabledModules.has("VEHICLES")) {
    queries.push(
      prisma.vehicle
        .findMany({
          where: {
            OR: [
              { label: contains },
              { make: contains },
              { model: contains },
              { licensePlate: contains },
            ],
          },
          select: { id: true, label: true, make: true, model: true },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.label,
            subtitle: [r.make, r.model].filter(Boolean).join(" ") || undefined,
            href: `/vehicles/${r.id}`,
            group: "Vehicles",
          })),
        ),
    );

    queries.push(
      prisma.vehicleItemDocument
        .findMany({
          where: { filename: contains },
          select: {
            id: true,
            filename: true,
            vehicleItem: { select: { vehicleId: true, vehicle: { select: { label: true } } } },
          },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.filename,
            subtitle: r.vehicleItem.vehicle.label,
            href: `/vehicles/${r.vehicleItem.vehicleId}`,
            group: "Documents",
          })),
        ),
    );
  }

  if (enabledModules.has("TRAVEL")) {
    queries.push(
      prisma.trip
        .findMany({
          where: { OR: [{ title: contains }, { destination: contains }] },
          select: { id: true, title: true, destination: true },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.title,
            subtitle: r.destination ?? undefined,
            href: `/travel/${r.id}`,
            group: "Travel",
          })),
        ),
    );

    queries.push(
      prisma.tripSegmentDocument
        .findMany({
          where: { filename: contains },
          select: {
            id: true,
            filename: true,
            tripSegment: { select: { tripId: true, trip: { select: { title: true } } } },
          },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.filename,
            subtitle: r.tripSegment.trip.title,
            href: `/travel/${r.tripSegment.tripId}`,
            group: "Documents",
          })),
        ),
    );
  }

  if (enabledModules.has("HOME")) {
    queries.push(
      prisma.property
        .findMany({
          where: { OR: [{ label: contains }, { address: contains }] },
          select: { id: true, label: true, address: true },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.label,
            subtitle: r.address ?? undefined,
            href: `/home/${r.id}`,
            group: "Home",
          })),
        ),
    );

    queries.push(
      prisma.homeItem
        .findMany({
          where: { OR: [{ title: contains }, { provider: contains }] },
          select: {
            id: true,
            title: true,
            propertyId: true,
            property: { select: { label: true } },
          },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.title,
            subtitle: r.property.label,
            href: `/home/${r.propertyId}/items/${r.id}`,
            group: "Home",
          })),
        ),
    );

    queries.push(
      prisma.homeItemDocument
        .findMany({
          where: { filename: contains },
          select: {
            id: true,
            filename: true,
            homeItem: { select: { id: true, propertyId: true, title: true } },
          },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.filename,
            subtitle: r.homeItem.title,
            href: `/home/${r.homeItem.propertyId}/items/${r.homeItem.id}`,
            group: "Documents",
          })),
        ),
    );
  }

  if (enabledModules.has("INVENTORY")) {
    queries.push(
      prisma.inventoryItem
        .findMany({
          where: { OR: [{ label: contains }, { brand: contains }, { model: contains }] },
          select: { id: true, label: true, brand: true },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.label,
            subtitle: r.brand ?? undefined,
            href: `/inventory/${r.id}`,
            group: "Inventory",
          })),
        ),
    );

    queries.push(
      prisma.inventoryItemDocument
        .findMany({
          where: { filename: contains },
          select: { id: true, filename: true, inventoryItem: { select: { id: true, label: true } } },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.filename,
            subtitle: r.inventoryItem.label,
            href: `/inventory/${r.inventoryItem.id}`,
            group: "Documents",
          })),
        ),
    );
  }

  if (enabledModules.has("WEALTH")) {
    queries.push(
      prisma.portfolio
        .findMany({
          where: { name: contains },
          select: { id: true, name: true },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.name,
            href: `/wealth/portfolios/${r.id}`,
            group: "Wealth",
          })),
        ),
    );
  }

  const results = (await Promise.all(queries)).flat();
  const groups: Record<string, SearchResult[]> = {};
  for (const r of results) {
    (groups[r.group] ??= []).push(r);
  }

  return NextResponse.json({ groups });
}
