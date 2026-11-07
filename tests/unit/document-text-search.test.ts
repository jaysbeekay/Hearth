// #398 — every Document kind's contents are searchable, not only Contracts'
// and Products'. Driven from the outside: a Document is filed (or was filed
// before this change), the job runner works through what's queued, and
// Search is asked for a word that only appears inside the file.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import type { ModuleKey } from "@/lib/modules/registry";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1", role: "MEMBER" } })) }));
// pdftotext/tesseract are the system boundary: the stub "reads" the text the
// test wrote into the file after a marker line.
vi.mock("@/lib/documents/textExtraction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/documents/textExtraction")>();
  return {
    ...actual,
    extractSearchableText: vi.fn(async (buffer: Buffer) => buffer.toString("utf8").split("TEXT:")[1] ?? null),
  };
});

const db = setupTestDb();
const { addDocumentCommand } = await import("@/lib/commands/documents");
const { runPendingJobs, enqueueJobUnlessPending } = await import("@/lib/jobs/runner");
const { GET } = await import("@/app/api/search/route");
const { extractSearchableText } = await import("@/lib/documents/textExtraction");

const OPT_IN_MODULES: ModuleKey[] = ["TRAVEL", "HOME", "VEHICLES", "INVENTORY", "WEALTH"];

let actorId: string;
beforeEach(async () => {
  vi.clearAllMocks();
  actorId = (await createTestUser()).id;
  for (const key of OPT_IN_MODULES) await setModuleEnabled(key, true);
});

function pdf(text: string, name = "receipt.pdf") {
  return new File([`%PDF-1.4\nTEXT:${text}`], name, { type: "application/pdf" });
}

async function drainJobs() {
  for (let i = 0; i < 20; i += 1) await runPendingJobs();
}

interface Hit {
  title: string;
  subtitle?: string;
  href: string;
  matchedInDocument?: boolean;
}

async function documentHits(q: string): Promise<Hit[]> {
  const res = await GET(new NextRequest(`http://localhost/api/search?q=${encodeURIComponent(q)}`));
  const body = (await res.json()) as { groups: Record<string, Hit[]> };
  return body.groups.Documents ?? [];
}

async function serviceRecord() {
  const vehicle = await db.prisma.vehicle.create({ data: { label: "Corolla", createdById: actorId } });
  const item = await db.prisma.vehicleItem.create({
    data: { vehicleId: vehicle.id, type: "SERVICE", title: "Logbook service" },
  });
  return { ownerId: item.id, href: `/vehicles/${vehicle.id}`, subtitle: "Logbook service · Corolla" };
}

type Owner = { ownerId: string; href: string; subtitle: string };

const OTHER_OWNERS: [string, "HOME_ITEM" | "TRIP_SEGMENT" | "RENTAL_STATEMENT" | "TRADE", () => Promise<Owner>][] = [
  [
    "a Maintenance record's invoice",
    "HOME_ITEM",
    async () => {
      const prop = await db.prisma.property.create({ data: { label: "House", createdById: actorId } });
      const item = await db.prisma.homeItem.create({ data: { propertyId: prop.id, type: "MAINTENANCE", title: "Gutter clean" } });
      return { ownerId: item.id, href: `/home/${prop.id}`, subtitle: "Gutter clean · House" };
    },
  ],
  [
    "a Trip segment's booking",
    "TRIP_SEGMENT",
    async () => {
      const trip = await db.prisma.trip.create({ data: { title: "Japan", createdById: actorId } });
      const seg = await db.prisma.tripSegment.create({ data: { tripId: trip.id, type: "FLIGHT", title: "SYD-NRT" } });
      return { ownerId: seg.id, href: `/travel/${trip.id}`, subtitle: "SYD-NRT · Japan" };
    },
  ],
  [
    "a Rental statement",
    "RENTAL_STATEMENT",
    async () => {
      const prop = await db.prisma.property.create({ data: { label: "Unit 4", createdById: actorId } });
      const s = await db.prisma.rentalStatement.create({ data: { propertyId: prop.id } });
      return { ownerId: s.id, href: `/home/${prop.id}/rental`, subtitle: "Rental statement · Unit 4" };
    },
  ],
  [
    "a Trade confirmation",
    "TRADE",
    async () => {
      const pf = await db.prisma.portfolio.create({ data: { name: "Shares", createdById: actorId } });
      const h = await db.prisma.holding.create({ data: { portfolioId: pf.id, ticker: "VAS" } });
      const t = await db.prisma.trade.create({
        data: { holdingId: h.id, type: "BUY", date: new Date("2026-01-02"), units: 10, pricePerUnit: 90 },
      });
      return { ownerId: t.id, href: `/wealth/portfolios/${pf.id}/holdings/${h.id}`, subtitle: "Trade · VAS" };
    },
  ],
];

describe("Search finds a Document by its contents", () => {
  it.each(OTHER_OWNERS)("%s, naming and linking to its record", async (_label, kind, makeOwner) => {
    const owner = await makeOwner();
    await addDocumentCommand(kind, owner.ownerId, { file: pdf("contains the word quokka") });
    await drainJobs();

    expect(await documentHits("quokka")).toEqual([
      { id: expect.any(String), title: "receipt.pdf", subtitle: owner.subtitle, href: owner.href, group: "Documents", matchedInDocument: true },
    ]);
  });

  it("a Service record's receipt, naming and linking to the Service record", async () => {
    const owner = await serviceRecord();
    await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, { file: pdf("replaced the timing belt") });
    await drainJobs();

    expect(await documentHits("timing belt")).toEqual([
      { id: expect.any(String), title: "receipt.pdf", subtitle: owner.subtitle, href: owner.href, group: "Documents", matchedInDocument: true },
    ]);
    expect(extractSearchableText).toHaveBeenCalledTimes(1);
  });

  it("doesn't try to extract text from a Word document, which is found by name only", async () => {
    const owner = await serviceRecord();
    // A .docx is a ZIP; the upload check looks for its header.
    const docx = new File(["PK\x03\x04TEXT:replaced the timing belt"], "quote.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, { file: docx });
    await drainJobs();

    expect(extractSearchableText).not.toHaveBeenCalled();
    expect(await documentHits("timing belt")).toEqual([]);
    expect((await documentHits("quote")).map((h) => [h.title, h.matchedInDocument])).toEqual([["quote.docx", false]]);
  });

  it("leaves a turned-off module's Documents out, whatever they contain", async () => {
    const owner = await serviceRecord();
    await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, { file: pdf("replaced the timing belt") });
    await drainJobs();
    await setModuleEnabled("VEHICLES", false);

    expect(await documentHits("timing belt")).toEqual([]);
  });
});

// A Document filed before #398: its row has no extraction status and
// nothing is queued for it. Filed through the command (so the file is
// really on disk), then put back the way the migration leaves old rows.
async function filedBeforeThisChange(file: File) {
  const owner = await serviceRecord();
  const doc = await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, { file });
  await db.prisma.vehicleItemDocument.update({ where: { id: doc.id }, data: { extractionStatus: null } });
  await db.prisma.backgroundJob.deleteMany({});
  vi.mocked(extractSearchableText).mockClear();
  return doc;
}

async function runBackfill() {
  await enqueueJobUnlessPending("DOCUMENT_TEXT_BACKFILL");
  await drainJobs();
}

describe("Backfill of Documents filed before text search", () => {
  it("makes their contents searchable", async () => {
    await filedBeforeThisChange(pdf("replaced the timing belt"));
    expect(await documentHits("timing belt")).toEqual([]);

    await runBackfill();

    expect((await documentHits("timing belt")).map((h) => h.title)).toEqual(["receipt.pdf"]);
  });

  it("works through them in batches of 25, queueing the next batch itself until none are left", async () => {
    const words = Array.from({ length: 30 }, (_, i) => `wombat${String(i).padStart(2, "0")}x`);
    for (const word of words) await filedBeforeThisChange(pdf(word));

    await runBackfill();

    for (const word of words) expect(await documentHits(word)).toHaveLength(1);
    const runs = await db.prisma.backgroundJob.findMany({ where: { type: "DOCUMENT_TEXT_BACKFILL" } });
    expect(runs.map((r) => r.status)).toEqual(["DONE", "DONE"]);
    expect(await db.prisma.backgroundJob.count({ where: { status: { not: "DONE" } } })).toBe(0);
  });

  it("skips a Document in Trash, and picks it up once it's restored", async () => {
    const doc = await filedBeforeThisChange(pdf("replaced the timing belt"));
    await db.prisma.vehicleItemDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });

    await runBackfill();
    expect(extractSearchableText).not.toHaveBeenCalled();

    await db.prisma.vehicleItemDocument.update({ where: { id: doc.id }, data: { deletedAt: null } });
    await runBackfill();
    expect((await documentHits("timing belt")).map((h) => h.title)).toEqual(["receipt.pdf"]);
  });

  it("settles a Word document without extracting it, so it isn't picked up again", async () => {
    await filedBeforeThisChange(
      new File(["PK\x03\x04"], "quote.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );

    await runBackfill();
    await runBackfill();

    expect(extractSearchableText).not.toHaveBeenCalled();
    expect(await db.prisma.backgroundJob.count({ where: { type: "OCR_DOCUMENT" } })).toBe(0);
    expect(await db.prisma.backgroundJob.count({ where: { status: { not: "DONE" } } })).toBe(0);
  });

  it("retries a Document whose extraction fails, then gives up on it with the error logged", async () => {
    await filedBeforeThisChange(pdf("replaced the timing belt"));
    vi.mocked(extractSearchableText).mockRejectedValue(new Error("tesseract crashed"));
    // A failed job waits 30s before its retry; only the clock is faked.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await runBackfill();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        vi.setSystemTime(Date.now() + 31_000);
        await drainJobs();
      }
      await runBackfill();
    } finally {
      vi.useRealTimers();
    }

    expect(extractSearchableText).toHaveBeenCalledTimes(3);
    const ocr = await db.prisma.backgroundJob.findMany({ where: { type: "OCR_DOCUMENT" } });
    expect(ocr.map((j) => [j.status, j.attempts, j.lastError])).toEqual([["FAILED", 3, "tesseract crashed"]]);
    expect(await documentHits("timing belt")).toEqual([]);
  });
});
