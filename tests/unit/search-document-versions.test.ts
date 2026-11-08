// Search shows one result per Document, as its record's page does: the
// latest version, or an older one, saying so, when only that matched.
// Driven through the Document commands and GET /api/search; files are named
// so the index matches them by filename, with no text extraction involved.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1", role: "MEMBER" } })) }));

const db = setupTestDb();
const { addDocumentCommand, supersedeDocumentCommand, deleteDocumentCommand } = await import("@/lib/commands/documents");
const { GET } = await import("@/app/api/search/route");

let actorId: string;
beforeEach(async () => {
  actorId = (await createTestUser()).id;
  for (const key of ["VEHICLES", "HOME", "TRAVEL", "WEALTH", "INVENTORY"] as const) await setModuleEnabled(key, true);
});

function docx(name: string) {
  // A .docx is a ZIP; the upload check looks for its header. Word documents
  // aren't extracted, so only the filename is indexed.
  return new File(["PK\x03\x04"], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

async function documentHits(q: string) {
  const res = await GET(new NextRequest(`http://localhost/api/search?q=${encodeURIComponent(q)}`));
  const body = (await res.json()) as { groups: Record<string, { id: string; title: string; subtitle?: string }[]> };
  return (body.groups.Documents ?? []).map((h) => ({ id: h.id, title: h.title, subtitle: h.subtitle }));
}

async function serviceRecord() {
  const vehicle = await db.prisma.vehicle.create({ data: { label: "Corolla", createdById: actorId } });
  const item = await db.prisma.vehicleItem.create({ data: { vehicleId: vehicle.id, type: "SERVICE", title: "Logbook service" } });
  return item.id;
}

describe("Search shows one result per Document", () => {
  it("shows only the latest version when old and new both match", async () => {
    const owner = await serviceRecord();
    const v1 = await addDocumentCommand("VEHICLE_ITEM", owner, { file: docx("quokka-invoice.docx") });
    const v2 = await supersedeDocumentCommand("VEHICLE_ITEM", v1.id, { file: docx("quokka-invoice-final.docx") });

    expect(await documentHits("quokka")).toEqual([
      { id: v2.id, title: "quokka-invoice-final.docx", subtitle: "Logbook service · Corolla" },
    ]);
  });

  it("shows an older version that's the only match, saying it's an older version", async () => {
    const owner = await serviceRecord();
    const v1 = await addDocumentCommand("VEHICLE_ITEM", owner, { file: docx("quokka-invoice.docx") });
    await supersedeDocumentCommand("VEHICLE_ITEM", v1.id, { file: docx("invoice-final.docx") });

    expect(await documentHits("quokka")).toEqual([
      { id: v1.id, title: "quokka-invoice.docx", subtitle: "Older version · Logbook service · Corolla" },
    ]);
  });

  it("shows one older version for several that match, the best match", async () => {
    const owner = await serviceRecord();
    const v1 = await addDocumentCommand("VEHICLE_ITEM", owner, { file: docx("quokka-quote-from-the-first-garage-we-asked.docx") });
    const v2 = await supersedeDocumentCommand("VEHICLE_ITEM", v1.id, { file: docx("quokka.docx") });
    await supersedeDocumentCommand("VEHICLE_ITEM", v2.id, { file: docx("invoice-final.docx") });

    expect((await documentHits("quokka")).map((h) => h.id)).toEqual([v2.id]);
  });

  it("follows the chain past a version in Trash, as the record page does", async () => {
    const owner = await serviceRecord();
    const v1 = await addDocumentCommand("VEHICLE_ITEM", owner, { file: docx("quokka-invoice.docx") });
    const v2 = await supersedeDocumentCommand("VEHICLE_ITEM", v1.id, { file: docx("quokka-invoice-v2.docx") });
    const v3 = await supersedeDocumentCommand("VEHICLE_ITEM", v2.id, { file: docx("quokka-invoice-v3.docx") });
    await deleteDocumentCommand("VEHICLE_ITEM", v2.id);

    expect((await documentHits("quokka")).map((h) => h.id)).toEqual([v3.id]);
  });

  it("labels an older version that's the only match past a version in Trash", async () => {
    const owner = await serviceRecord();
    const v1 = await addDocumentCommand("VEHICLE_ITEM", owner, { file: docx("quokka-invoice.docx") });
    const v2 = await supersedeDocumentCommand("VEHICLE_ITEM", v1.id, { file: docx("invoice-v2.docx") });
    await supersedeDocumentCommand("VEHICLE_ITEM", v2.id, { file: docx("invoice-v3.docx") });
    await deleteDocumentCommand("VEHICLE_ITEM", v2.id);

    expect(await documentHits("quokka")).toEqual([
      { id: v1.id, title: "quokka-invoice.docx", subtitle: "Older version · Logbook service · Corolla" },
    ]);
  });

  it("keeps the latest version in its own place among other Documents", async () => {
    const owner = await serviceRecord();
    // Ranked by filename length: the short one first, the long old version last.
    const v1 = await addDocumentCommand("VEHICLE_ITEM", owner, { file: docx("quokka-invoice-from-the-garage-on-main-street.docx") });
    const other = await addDocumentCommand("VEHICLE_ITEM", owner, { file: docx("quokka-receipt-for-tyres.docx") });
    const v2 = await supersedeDocumentCommand("VEHICLE_ITEM", v1.id, { file: docx("quokka.docx") });

    expect((await documentHits("quokka")).map((h) => h.id)).toEqual([v2.id, other.id]);
  });

  it("lists each row on its own if a chain loops back, as the record page does", async () => {
    const owner = await serviceRecord();
    const a = await addDocumentCommand("VEHICLE_ITEM", owner, { file: docx("quokka-a.docx") });
    const b = await supersedeDocumentCommand("VEHICLE_ITEM", a.id, { file: docx("quokka-b.docx") });
    // The app never writes a cycle; made by hand.
    await db.prisma.vehicleItemDocument.update({ where: { id: a.id }, data: { supersedesId: b.id } });

    expect((await documentHits("quokka")).map((h) => h.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("treats an older version as the latest when every newer one is in Trash", async () => {
    const owner = await serviceRecord();
    const v1 = await addDocumentCommand("VEHICLE_ITEM", owner, { file: docx("quokka-invoice.docx") });
    const v2 = await supersedeDocumentCommand("VEHICLE_ITEM", v1.id, { file: docx("invoice-final.docx") });
    await deleteDocumentCommand("VEHICLE_ITEM", v2.id);

    expect(await documentHits("quokka")).toEqual([
      { id: v1.id, title: "quokka-invoice.docx", subtitle: "Logbook service · Corolla" },
    ]);
  });

  it("keeps separate Documents separate", async () => {
    const owner = await serviceRecord();
    await addDocumentCommand("VEHICLE_ITEM", owner, { file: docx("quokka-invoice.docx") });
    await addDocumentCommand("VEHICLE_ITEM", owner, { file: docx("quokka-receipt.docx") });

    expect((await documentHits("quokka")).map((h) => h.title).sort()).toEqual(["quokka-invoice.docx", "quokka-receipt.docx"]);
  });

  const OTHER_KINDS: [string, "PRODUCT" | "INVENTORY_ITEM" | "HOME_ITEM" | "TRIP_SEGMENT" | "RENTAL_STATEMENT" | "TRADE", () => Promise<string>][] = [
    ["a Warranty's", "PRODUCT", async () => (await db.prisma.product.create({ data: { description: "Fridge", createdById: actorId } })).id],
    ["an Inventory item's", "INVENTORY_ITEM", async () => (await db.prisma.inventoryItem.create({ data: { label: "Drill", createdById: actorId } })).id],
    [
      "a Maintenance record's",
      "HOME_ITEM",
      async () => {
        const prop = await db.prisma.property.create({ data: { label: "House", createdById: actorId } });
        return (await db.prisma.homeItem.create({ data: { propertyId: prop.id, type: "MAINTENANCE", title: "Gutters" } })).id;
      },
    ],
    [
      "a Trip segment's",
      "TRIP_SEGMENT",
      async () => {
        const trip = await db.prisma.trip.create({ data: { title: "Japan", createdById: actorId } });
        return (await db.prisma.tripSegment.create({ data: { tripId: trip.id, type: "FLIGHT", title: "SYD-NRT" } })).id;
      },
    ],
    [
      "a Rental statement's",
      "RENTAL_STATEMENT",
      async () => {
        const prop = await db.prisma.property.create({ data: { label: "Unit 4", createdById: actorId } });
        return (await db.prisma.rentalStatement.create({ data: { propertyId: prop.id } })).id;
      },
    ],
    [
      "a Trade's",
      "TRADE",
      async () => {
        const pf = await db.prisma.portfolio.create({ data: { name: "Shares", createdById: actorId } });
        const h = await db.prisma.holding.create({ data: { portfolioId: pf.id, ticker: "VAS" } });
        return (await db.prisma.trade.create({ data: { holdingId: h.id, type: "BUY", date: new Date("2026-01-02"), units: 1, pricePerUnit: 1 } })).id;
      },
    ],
  ];

  it.each(OTHER_KINDS)("does the same for %s Documents", async (_label, kind, makeOwner) => {
    const owner = await makeOwner();
    const v1 = await addDocumentCommand(kind, owner, { file: docx("quokka-v1.docx") });
    const v2 = await supersedeDocumentCommand(kind, v1.id, { file: docx("quokka-v2.docx") });
    const v3 = await supersedeDocumentCommand(kind, v2.id, { file: docx("final.docx") });

    const hits = await documentHits("quokka");
    expect(hits.map((h) => h.id)).toHaveLength(1);
    expect([v1.id, v2.id]).toContain(hits[0].id);
    expect(hits[0].subtitle).toMatch(/^Older version · /);
    expect((await documentHits("final")).map((h) => h.id)).toEqual([v3.id]);
  });

  it("does the same for a Contract's Documents", async () => {
    const contract = await db.prisma.contract.create({
      data: { title: "Insurance", category: "OTHER", provider: "Acme", createdById: actorId },
    });
    const v1 = await addDocumentCommand("CONTRACT", contract.id, { file: docx("quokka-policy.docx"), extractedText: "" });
    const v2 = await supersedeDocumentCommand("CONTRACT", v1.id, { file: docx("policy-2026.docx"), extractedText: "" });

    expect(await documentHits("quokka")).toEqual([{ id: v1.id, title: "quokka-policy.docx", subtitle: "Older version · Insurance" }]);
    expect((await documentHits("policy")).map((h) => h.id)).toEqual([v2.id]);
  });
});
