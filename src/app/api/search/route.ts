import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { formatPropertyAddress } from "@/lib/utils";

export interface SearchResult {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  group: string;
  // True when the query only matched text inside an attached document, not
  // any of the record's own fields — surfaced in the UI so a Contract and
  // one of its Documents both showing up for the same query reads as
  // intentional, not duplicated.
  matchedInDocument?: boolean;
}

const LIMIT = 8;

function matchedViaFields(q: string, fields: (string | null | undefined)[]) {
  const needle = q.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(needle));
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  // #205 — memory-fragment filters. Scoped to Contract/Product, the two
  // record types with both an expiry date and the extraction-review/
  // document infrastructure these filters key off; other domains stay
  // text-search-only rather than growing bespoke "expiring"/"needsReview"
  // semantics for shapes that don't naturally have them.
  const FILTER_VALUES = ["expiring", "needsReview", "noDocument", "important"] as const;
  type SearchFilter = (typeof FILTER_VALUES)[number];
  const filterParam = request.nextUrl.searchParams.get("filter");
  const filter: SearchFilter | undefined = (FILTER_VALUES as readonly string[]).includes(
    filterParam ?? "",
  )
    ? (filterParam as SearchFilter)
    : undefined;

  const textOk = q.length >= 2;
  if (!textOk && !filter) {
    return NextResponse.json({ groups: {} });
  }

  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 86_400_000);

  const enabledModules = await getEnabledModuleKeys();
  const contains = { contains: q };
  const queries: Promise<SearchResult[]>[] = [];

  queries.push(
    prisma.contract
      .findMany({
        where: {
          AND: [
            ...(textOk
              ? [
                  {
                    OR: [
                      { title: contains },
                      { provider: contains },
                      { contractNumber: contains },
                      { documents: { some: { extractedText: contains } } },
                    ],
                  },
                ]
              : []),
            ...(filter === "expiring" ? [{ status: "ACTIVE" as const, endDate: { gte: now, lte: soon } }] : []),
            ...(filter === "needsReview" ? [{ extractionPending: true }] : []),
            ...(filter === "noDocument" ? [{ documents: { none: {} } }] : []),
            ...(filter === "important" ? [{ documents: { some: { isImportant: true } } }] : []),
          ],
        },
        select: { id: true, title: true, provider: true, contractNumber: true },
        take: LIMIT,
      })
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          subtitle:
            textOk && matchedViaFields(q, [r.contractNumber]) && !matchedViaFields(q, [r.title, r.provider])
              ? [r.provider, `№ ${r.contractNumber}`].filter(Boolean).join(" · ")
              : r.provider,
          href: `/contracts/${r.id}`,
          group: "Contracts",
          matchedInDocument: textOk ? !matchedViaFields(q, [r.title, r.provider, r.contractNumber]) : false,
        })),
      ),
  );

  queries.push(
    prisma.product
      .findMany({
        where: {
          AND: [
            ...(textOk
              ? [
                  {
                    OR: [
                      { description: contains },
                      { manufacturer: contains },
                      { model: contains },
                      { vendor: contains },
                      { serialNumber: contains },
                      { barcode: contains },
                      { documents: { some: { extractedText: contains } } },
                    ],
                  },
                ]
              : []),
            ...(filter === "expiring" ? [{ warrantyEndDate: { gte: now, lte: soon } }] : []),
            ...(filter === "needsReview" ? [{ extractionPending: true }] : []),
            ...(filter === "noDocument" ? [{ documents: { none: {} } }] : []),
            ...(filter === "important" ? [{ documents: { some: { isImportant: true } } }] : []),
          ],
        },
        select: {
          id: true,
          description: true,
          manufacturer: true,
          vendor: true,
          serialNumber: true,
          barcode: true,
        },
        take: LIMIT,
      })
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          title: r.description,
          subtitle:
            textOk &&
            matchedViaFields(q, [r.serialNumber, r.barcode]) &&
            !matchedViaFields(q, [r.description, r.manufacturer, r.vendor])
              ? [r.manufacturer, `# ${r.serialNumber ?? r.barcode}`].filter(Boolean).join(" · ")
              : (r.manufacturer ?? undefined),
          href: `/products/${r.id}`,
          group: "Products",
          matchedInDocument: textOk
            ? !matchedViaFields(q, [r.description, r.manufacturer, r.vendor, r.serialNumber, r.barcode])
            : false,
        })),
      ),
  );

  if (textOk) {
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
          select: { id: true, filename: true, product: { select: { id: true, description: true } } },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.filename,
            subtitle: r.product.description,
            href: `/products/${r.product.id}`,
            group: "Documents",
          })),
        ),
    );
  }

  if (enabledModules.has("VEHICLES") && textOk) {
    queries.push(
      prisma.vehicle
        .findMany({
          where: {
            OR: [
              { label: contains },
              { make: contains },
              { model: contains },
              { licensePlate: contains },
              { vin: contains },
            ],
          },
          select: { id: true, label: true, make: true, model: true, licensePlate: true, vin: true },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.label,
            subtitle:
              matchedViaFields(q, [r.vin, r.licensePlate]) && !matchedViaFields(q, [r.make, r.model])
                ? [[r.make, r.model].filter(Boolean).join(" "), r.licensePlate ?? r.vin]
                    .filter(Boolean)
                    .join(" · ")
                : [r.make, r.model].filter(Boolean).join(" ") || undefined,
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

  if (enabledModules.has("TRAVEL") && textOk) {
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
      prisma.tripSegment
        .findMany({
          where: { confirmationCode: contains },
          select: { id: true, title: true, confirmationCode: true, tripId: true, trip: { select: { title: true } } },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.title,
            subtitle: [r.trip.title, `Conf. ${r.confirmationCode}`].filter(Boolean).join(" · "),
            href: `/travel/${r.tripId}`,
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

  if (enabledModules.has("HOME") && textOk) {
    queries.push(
      prisma.property
        .findMany({
          where: {
            OR: [
              { label: contains },
              { street: contains },
              { suburb: contains },
              { state: contains },
              { postcode: contains },
              { country: contains },
            ],
          },
          select: {
            id: true,
            label: true,
            street: true,
            suburb: true,
            state: true,
            postcode: true,
            country: true,
          },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.label,
            subtitle: formatPropertyAddress(r) || undefined,
            href: `/home/${r.id}`,
            group: "Property",
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
            group: "Property",
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

  if (enabledModules.has("INVENTORY") && textOk) {
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

  if (enabledModules.has("WEALTH") && textOk) {
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

  // #199 — an unfiled document is still findable by name/content, so a
  // household member who half-remembers uploading something isn't limited
  // to browsing the Documents inbox tab to rediscover it.
  if (textOk) {
    queries.push(
      prisma.inboxDocument
        .findMany({
          where: { OR: [{ filename: contains }, { extractedText: contains }] },
          select: { id: true, filename: true },
          take: LIMIT,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            title: r.filename,
            href: "/documents/inbox",
            group: "Inbox",
            matchedInDocument: !matchedViaFields(q, [r.filename]),
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
