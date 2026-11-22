// #398 — every Document kind's contents are searchable, not only Contracts'
// and Products'. Driven from the outside: a Document is filed (or was filed
// before this change), the job runner works through what's queued, and
// Search is asked for a word that only appears inside the file.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import type { ModuleKey } from "@/lib/modules/registry";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1", role: "MEMBER" } })) }));
// pdftotext/tesseract are the system boundary: the stubs "read" the text the
// test wrote into the file after a marker line, and say which tools are
// installed. extractTextDetailed is what these kinds use; Contracts still go
// through extractSearchableText.
const readText = (buffer: Buffer) => buffer.toString("utf8").split("TEXT:")[1] ?? "";
const ALL_TOOLS = {
  binaries: { pdftotext: true, pdftoppm: true, tesseract: true },
  status: { pdftotext: "available", pdftoppm: "available", tesseract: "available" },
  pdfText: true,
  pdfOcr: true,
  imageOcr: true,
} as const;
const PDFTOTEXT_ONLY = {
  binaries: { pdftotext: true, pdftoppm: false, tesseract: false },
  status: { pdftotext: "available", pdftoppm: "missing", tesseract: "missing" },
  pdfText: true,
  pdfOcr: false,
  imageOcr: false,
} as const;
const NO_TOOLS = {
  binaries: { pdftotext: false, pdftoppm: false, tesseract: false },
  status: { pdftotext: "missing", pdftoppm: "missing", tesseract: "missing" },
  pdfText: false,
  pdfOcr: false,
  imageOcr: false,
} as const;
vi.mock("@/lib/documents/textExtraction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/documents/textExtraction")>();
  return {
    ...actual,
    extractTextDetailed: vi.fn(async (buffer: Buffer) => ({ text: readText(buffer), unavailable: false })),
    extractSearchableText: vi.fn(async (buffer: Buffer) => readText(buffer) || null),
    getExtractionCapabilities: vi.fn(async () => ALL_TOOLS),
  };
});
// Only so a test can make queueing fail; otherwise the real queue.
vi.mock("@/lib/documents/queueExtraction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/documents/queueExtraction")>();
  return { ...actual, queueDocumentExtraction: vi.fn(actual.queueDocumentExtraction) };
});

const db = setupTestDb();
const { addDocumentCommand, purgeDocument } = await import("@/lib/commands/documents");
const { runOneJob, enqueueJobUnlessPending } = await import("@/lib/jobs/runner");
const { GET } = await import("@/app/api/search/route");
const { POST: cronPOST } = await import("@/app/api/cron/route");
const { extractTextDetailed, getExtractionCapabilities } = await import("@/lib/documents/textExtraction");
const { queueDocumentExtraction } = await import("@/lib/documents/queueExtraction");
const { runDocumentTextBackfill } = await import("@/lib/documents/documentText");
const { documentStoreFor } = await import("@/lib/storage");

const OPT_IN_MODULES: ModuleKey[] = ["TRAVEL", "HOME", "VEHICLES", "INVENTORY", "WEALTH"];

let actorId: string;
beforeEach(async () => {
  vi.clearAllMocks();
  // Back to the defaults a test may have changed.
  vi.mocked(getExtractionCapabilities).mockResolvedValue(ALL_TOOLS);
  vi.mocked(extractTextDetailed).mockImplementation(async (buffer: Buffer) => ({ text: readText(buffer), unavailable: false }));
  actorId = (await createTestUser()).id;
  for (const key of OPT_IN_MODULES) await setModuleEnabled(key, true);
});
afterEach(() => {
  vi.useRealTimers();
});

function pdf(text: string, name = "receipt.pdf", type = "application/pdf") {
  return new File([`%PDF-1.4\nTEXT:${text}`], name, { type });
}

function png(text: string, name = "photo.png") {
  return new File([Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`TEXT:${text}`)])], name, {
    type: "image/png",
  });
}

function docx(name: string, text = "") {
  // A .docx is a ZIP; the upload check looks for its header.
  return new File([`PK\x03\x04TEXT:${text}`], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

// Runs jobs until none is runnable now. Stopping at the first empty claim is
// safe because no job is ever queued to become due within milliseconds: a
// retry waits 30s, the backfill's next batch a minute, and these tests' own
// delayed jobs an hour. The cap (the old 20 × runPendingJobs(4)) only stops a
// runaway loop.
async function drainJobs() {
  for (let i = 0; i < 80; i += 1) {
    if (!(await runOneJob())) return;
  }
}

function jobsLeft() {
  return db.prisma.backgroundJob.count({ where: { status: { in: ["PENDING", "RUNNING"] } } });
}

// A failed job waits 30s before its retry, and the backfill a minute
// between batches; only the clock is faked, and moved past those waits.
// With nothing left queued, the remaining rounds would only move the
// clock, so it's moved for them at once and the test ends where it would.
async function drainJobsOverTime(rounds = 5) {
  vi.useFakeTimers({ toFake: ["Date"] });
  for (let i = 0; i < rounds; i += 1) {
    await drainJobs();
    if ((await jobsLeft()) === 0) {
      vi.setSystemTime(Date.now() + 61_000 * (rounds - i));
      return;
    }
    vi.setSystemTime(Date.now() + 61_000);
  }
  await drainJobs();
}

interface Hit {
  title: string;
  subtitle?: string;
  href: string;
  matchedInDocument?: boolean;
}

async function documentHits(q: string, extra = ""): Promise<Hit[]> {
  const res = await GET(new NextRequest(`http://localhost/api/search?q=${encodeURIComponent(q)}${extra}`));
  const body = (await res.json()) as { groups: Record<string, Hit[]> };
  return body.groups.Documents ?? [];
}

async function serviceRecord(date: Date | null = null) {
  const vehicle = await db.prisma.vehicle.create({ data: { label: "Corolla", createdById: actorId } });
  const item = await db.prisma.vehicleItem.create({
    data: { vehicleId: vehicle.id, type: "SERVICE", title: "Logbook service", date },
  });
  return { ownerId: item.id, href: `/vehicles/${vehicle.id}` };
}

type Owner = { ownerId: string; href: string; subtitle: string };

const OTHER_OWNERS: [string, "HOME_ITEM" | "TRIP_SEGMENT" | "RENTAL_STATEMENT" | "TRADE", () => Promise<Owner>][] = [
  [
    "a Maintenance record's invoice",
    "HOME_ITEM",
    async () => {
      const prop = await db.prisma.property.create({ data: { label: "House", createdById: actorId } });
      const item = await db.prisma.homeItem.create({
        data: { propertyId: prop.id, type: "MAINTENANCE", title: "Gutter clean", date: new Date("2025-05-14") },
      });
      return { ownerId: item.id, href: `/home/${prop.id}`, subtitle: "Gutter clean · 14 May 2025 · House" };
    },
  ],
  [
    "a Trip segment's booking",
    "TRIP_SEGMENT",
    async () => {
      const trip = await db.prisma.trip.create({ data: { title: "Japan", createdById: actorId } });
      const seg = await db.prisma.tripSegment.create({
        data: { tripId: trip.id, type: "FLIGHT", title: "SYD-NRT", startDate: new Date("2026-04-01") },
      });
      return { ownerId: seg.id, href: `/travel/${trip.id}`, subtitle: "SYD-NRT · 1 Apr 2026 · Japan" };
    },
  ],
  [
    "a Rental statement",
    "RENTAL_STATEMENT",
    async () => {
      const prop = await db.prisma.property.create({ data: { label: "Unit 4", createdById: actorId } });
      const s = await db.prisma.rentalStatement.create({
        data: { propertyId: prop.id, periodStart: new Date("2026-02-01"), statementDate: new Date("2026-03-03") },
      });
      return { ownerId: s.id, href: `/home/${prop.id}/rental`, subtitle: "Rental statement · 3 Mar 2026 · Unit 4" };
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
      return { ownerId: t.id, href: `/wealth/portfolios/${pf.id}/holdings/${h.id}`, subtitle: "Buy · 2 Jan 2026 · VAS" };
    },
  ],
];

function statusOf(id: string) {
  return db.prisma.vehicleItemDocument.findUniqueOrThrow({ where: { id } }).then((d) => d.extractionStatus);
}

describe("Search finds a Document by its contents", () => {
  it.each(OTHER_OWNERS)("%s, naming its record and date, and linking to it", async (_label, kind, makeOwner) => {
    const owner = await makeOwner();
    await addDocumentCommand(kind, owner.ownerId, { file: pdf("contains the word quokka") });
    await drainJobs();

    expect(await documentHits("quokka")).toEqual([
      { id: expect.any(String), title: "receipt.pdf", subtitle: owner.subtitle, href: owner.href, group: "Documents", matchedInDocument: true },
    ]);
  });

  it("a Service record's receipt, naming and linking to the Service record", async () => {
    const owner = await serviceRecord(new Date("2024-03-12"));
    await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, { file: pdf("replaced the timing belt") });
    await drainJobs();

    expect(await documentHits("timing belt")).toEqual([
      {
        id: expect.any(String),
        title: "receipt.pdf",
        subtitle: "Logbook service · 12 Mar 2024 · Corolla",
        href: owner.href,
        group: "Documents",
        matchedInDocument: true,
      },
    ]);
    expect(extractTextDetailed).toHaveBeenCalledTimes(1);
  });

  it("leaves the date out of the subtitle when the record has none", async () => {
    const owner = await serviceRecord();
    await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, { file: pdf("replaced the timing belt") });
    await drainJobs();

    expect((await documentHits("timing belt")).map((h) => h.subtitle)).toEqual(["Logbook service · Corolla"]);
  });

  it("extracts a PDF uploaded with a generic type, by the type it was stored as", async () => {
    const owner = await serviceRecord();
    const doc = await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, {
      file: pdf("replaced the timing belt", "scan.pdf", "application/octet-stream"),
    });
    expect(await statusOf(doc.id)).toBe("PENDING");

    await drainJobs();

    expect((await documentHits("timing belt")).map((h) => h.title)).toEqual(["scan.pdf"]);
  });

  it("doesn't try to extract text from a Word document, which is found by name only", async () => {
    const owner = await serviceRecord();
    const doc = await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, { file: docx("quote.docx", "replaced the timing belt") });
    await drainJobs();

    expect(extractTextDetailed).not.toHaveBeenCalled();
    expect(await statusOf(doc.id)).toBe("COMPLETED");
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

  it("doesn't let a turned-off module's matches crowd out ones that would show", async () => {
    const pf = await db.prisma.portfolio.create({ data: { name: "Shares", createdById: actorId } });
    const h = await db.prisma.holding.create({ data: { portfolioId: pf.id, ticker: "VAS" } });
    const t = await db.prisma.trade.create({
      data: { holdingId: h.id, type: "BUY", date: new Date("2026-01-02"), units: 1, pricePerUnit: 1 },
    });
    // More than the 60 ranked hits Search asks the index for.
    for (let i = 0; i < 65; i += 1) await addDocumentCommand("TRADE", t.id, { file: docx(`statement-${i}.docx`) });
    const owner = await serviceRecord();
    await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, { file: docx("statement-service.docx") });
    await setModuleEnabled("WEALTH", false);

    expect((await documentHits("statement")).map((hit) => hit.title)).toEqual(["statement-service.docx"]);
  });

  it("doesn't let Documents a list filter leaves out crowd out ones that would show", async () => {
    const owner = await serviceRecord();
    for (let i = 0; i < 65; i += 1) await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, { file: docx(`statement-${i}.docx`) });
    const contract = await db.prisma.contract.create({
      data: { title: "Insurance", category: "OTHER", provider: "Acme", createdById: actorId },
    });
    await addDocumentCommand("CONTRACT", contract.id, { file: docx("statement-policy.docx") });

    // Needs review: Vehicles, and so their Documents, are left out.
    expect((await documentHits("statement", "&review=1")).map((hit) => hit.title)).toEqual(["statement-policy.docx"]);
  });

  it("an image's contents too", async () => {
    const owner = await serviceRecord();
    await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, { file: png("odometer reads 84211") });
    await drainJobs();

    expect((await documentHits("84211")).map((h) => h.title)).toEqual(["photo.png"]);
  });

  it("ranks Documents across kinds, a filename match ahead of a content match", async () => {
    const contract = await db.prisma.contract.create({ data: { title: "Insurance", category: "OTHER", provider: "Acme", createdById: actorId } });
    await addDocumentCommand("CONTRACT", contract.id, { file: pdf("mentions a quokka once", "policy.pdf") });
    const owner = await serviceRecord();
    await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, { file: docx("quokka.docx") });
    await drainJobs();

    expect((await documentHits("quokka")).map((h) => h.title)).toEqual(["quokka.docx", "policy.pdf"]);
  });
});

describe("Extraction on upload", () => {
  it("retries when the tools aren't installed, logs why, and leaves it for once they are", async () => {
    vi.mocked(getExtractionCapabilities).mockResolvedValue(NO_TOOLS);
    vi.mocked(extractTextDetailed).mockResolvedValue({ text: "", unavailable: true });
    const owner = await serviceRecord();
    const doc = await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, { file: pdf("replaced the timing belt") });

    await drainJobsOverTime();

    expect(extractTextDetailed).toHaveBeenCalledTimes(3);
    const ocr = await db.prisma.backgroundJob.findMany({ where: { type: "OCR_DOCUMENT" } });
    expect(ocr.map((j) => [j.status, j.attempts])).toEqual([["FAILED", 3]]);
    expect(ocr[0].lastError).toMatch(/aren't installed/);
    expect(await statusOf(doc.id)).toBe("UNAVAILABLE");

    // Still missing: the backfill leaves it alone rather than failing again.
    await enqueueJobUnlessPending("DOCUMENT_TEXT_BACKFILL");
    await drainJobsOverTime();
    expect(extractTextDetailed).toHaveBeenCalledTimes(3);

    // Installed: the next backfill picks it up.
    vi.mocked(getExtractionCapabilities).mockResolvedValue(ALL_TOOLS);
    vi.mocked(extractTextDetailed).mockImplementation(async (buffer: Buffer) => ({ text: readText(buffer), unavailable: false }));
    await enqueueJobUnlessPending("DOCUMENT_TEXT_BACKFILL");
    await drainJobsOverTime();
    expect((await documentHits("timing belt")).map((h) => h.title)).toEqual(["receipt.pdf"]);
  });

  it("retries an extraction that crashes, then marks it FAILED with the error logged", async () => {
    vi.mocked(extractTextDetailed).mockRejectedValue(new Error("pdftoppm crashed"));
    const owner = await serviceRecord();
    const doc = await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, { file: pdf("replaced the timing belt") });

    await drainJobsOverTime();
    // FAILED isn't picked up again.
    await enqueueJobUnlessPending("DOCUMENT_TEXT_BACKFILL");
    await drainJobsOverTime();

    expect(extractTextDetailed).toHaveBeenCalledTimes(3);
    const ocr = await db.prisma.backgroundJob.findMany({ where: { type: "OCR_DOCUMENT" } });
    expect(ocr.map((j) => [j.status, j.attempts, j.lastError])).toEqual([["FAILED", 3, "pdftoppm crashed"]]);
    expect(await statusOf(doc.id)).toBe("FAILED");
  });

  it("marks it FAILED when the tools are installed but can't be run, so it doesn't come back", async () => {
    // tesseract is there but not executable (EACCES): the run marks it so.
    vi.mocked(extractTextDetailed).mockImplementation(async () => {
      vi.mocked(getExtractionCapabilities).mockResolvedValue({
        ...ALL_TOOLS,
        status: { ...ALL_TOOLS.status, tesseract: "unusable" },
        binaries: { ...ALL_TOOLS.binaries, tesseract: false },
        pdfOcr: false,
        imageOcr: false,
      });
      return { text: "", unavailable: true };
    });
    const owner = await serviceRecord();
    const doc = await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, { file: pdf("replaced the timing belt") });

    await drainJobsOverTime();
    await enqueueJobUnlessPending("DOCUMENT_TEXT_BACKFILL");
    await drainJobsOverTime();

    expect(await statusOf(doc.id)).toBe("FAILED");
    expect(extractTextDetailed).toHaveBeenCalledTimes(3);
    const ocr = await db.prisma.backgroundJob.findMany({ where: { type: "OCR_DOCUMENT" } });
    expect(ocr[0].lastError).toMatch(/couldn't be run/);
  });

  it("leaves it UNAVAILABLE when a tool was removed while the server ran", async () => {
    // Reported installed at start; the run hits ENOENT and marks it missing.
    vi.mocked(extractTextDetailed).mockImplementation(async () => {
      vi.mocked(getExtractionCapabilities).mockResolvedValue({
        ...ALL_TOOLS,
        status: { ...ALL_TOOLS.status, tesseract: "missing" },
        binaries: { ...ALL_TOOLS.binaries, tesseract: false },
        pdfOcr: false,
        imageOcr: false,
      });
      return { text: "", unavailable: true };
    });
    const owner = await serviceRecord();
    const doc = await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, { file: pdf("replaced the timing belt") });

    await drainJobsOverTime();

    expect(await statusOf(doc.id)).toBe("UNAVAILABLE");
  });

  it("marks it FAILED when its last attempt's lease runs out", async () => {
    const owner = await serviceRecord();
    const doc = await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, { file: pdf("replaced the timing belt") });
    // The process died during the last attempt.
    await db.prisma.backgroundJob.updateMany({
      where: { type: "OCR_DOCUMENT" },
      data: { status: "RUNNING", attempts: 3, leasedUntil: new Date(Date.now() - 1_000) },
    });

    await runOneJob();

    expect(await statusOf(doc.id)).toBe("FAILED");
  });

  it("leaves it for the backfill when the extraction couldn't be queued", async () => {
    vi.mocked(queueDocumentExtraction).mockRejectedValueOnce(new Error("database is locked"));
    const owner = await serviceRecord();
    const doc = await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, { file: pdf("replaced the timing belt") });
    expect(await statusOf(doc.id)).toBeNull();

    await enqueueJobUnlessPending("DOCUMENT_TEXT_BACKFILL");
    await drainJobsOverTime();

    expect((await documentHits("timing belt")).map((h) => h.title)).toEqual(["receipt.pdf"]);
  });

  it("finishes quietly when the Document was purged before its turn", async () => {
    const owner = await serviceRecord();
    const doc = await addDocumentCommand("VEHICLE_ITEM", owner.ownerId, { file: pdf("replaced the timing belt") });
    await db.prisma.vehicleItemDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
    await purgeDocument("VEHICLE_ITEM", doc.id);

    await drainJobs();

    expect(extractTextDetailed).not.toHaveBeenCalled();
    const ocr = await db.prisma.backgroundJob.findMany({ where: { type: "OCR_DOCUMENT" } });
    expect(ocr.map((j) => [j.status, j.attempts, j.lastError])).toEqual([["DONE", 1, null]]);
  });
});

// A Document filed before #398: its row has no extraction status and
// nothing is queued for it, the way the migration leaves old rows. The file
// is saved by its owner's real store, so it's really on disk where the
// extraction job reads it. Each Document gets its own Service record, so a
// job sent to the wrong owner's files fails; the records and rows are each
// written in one go, which keeps tests that need a batch's worth cheap (#647).
async function filedBeforeThisChange(file: File) {
  const [doc] = await allFiledBeforeThisChange([file]);
  return doc;
}

async function allFiledBeforeThisChange(files: File[]) {
  const vehicle = await db.prisma.vehicle.create({ data: { label: "Corolla", createdById: actorId } });
  const owners = await db.prisma.vehicleItem.createManyAndReturn({
    data: files.map(() => ({ vehicleId: vehicle.id, type: "SERVICE", title: "Logbook service" })),
  });
  const data = await oldDocumentFiles(
    "VEHICLE_ITEM",
    files.map((file, i) => ({ file, ownerId: owners[i].id })),
  );
  const rows = await db.prisma.vehicleItemDocument.createManyAndReturn({
    data: data.map(({ ownerId, ...d }) => ({ ...d, vehicleItemId: ownerId })),
  });
  return rows.map((row) => ({ ...row, ownerId: row.vehicleItemId }));
}

// Each call's Documents are filed after the last call's, a millisecond apart,
// so no two share an uploadedAt and the backfill's oldest-first order is the
// order they were filed in.
let lastFiledAt = 0;

// Saves each file where its kind's Documents are read from, and returns the
// row fields for it, with no extraction status.
async function oldDocumentFiles(kind: "VEHICLE_ITEM" | "HOME_ITEM", files: { file: File; ownerId: string }[]) {
  const store = documentStoreFor(kind);
  const filedAt = Math.max(Date.now() - files.length, lastFiledAt + 1);
  lastFiledAt = filedAt + files.length - 1;
  return Promise.all(
    files.map(async ({ file, ownerId }, i) => {
      const { storedName, mimeType, size, sha256 } = await store.save(ownerId, file);
      return { ownerId, filename: file.name, storedName, mimeType, size, sha256, uploadedAt: new Date(filedAt + i) };
    }),
  );
}

async function runBackfill() {
  await enqueueJobUnlessPending("DOCUMENT_TEXT_BACKFILL");
  await drainJobsOverTime();
}

describe("Backfill of Documents filed before text search", () => {
  beforeEach(() => {
    lastFiledAt = 0;
  });

  it("makes their contents searchable", async () => {
    await filedBeforeThisChange(pdf("replaced the timing belt"));
    expect(await documentHits("timing belt")).toEqual([]);

    await runBackfill();

    expect((await documentHits("timing belt")).map((h) => h.title)).toEqual(["receipt.pdf"]);
  });

  it("works through them in batches of 25, queueing the next batch itself until none are left", async () => {
    const words = Array.from({ length: 30 }, (_, i) => `wombat${String(i).padStart(2, "0")}x`);
    await allFiledBeforeThisChange(words.map((word) => pdf(word)));

    await enqueueJobUnlessPending("DOCUMENT_TEXT_BACKFILL");
    await runOneJob();
    expect(await db.prisma.backgroundJob.count({ where: { type: "OCR_DOCUMENT" } })).toBe(25);
    expect(await db.prisma.vehicleItemDocument.count({ where: { extractionStatus: null } })).toBe(5);

    await drainJobsOverTime();

    for (const word of words) expect(await documentHits(word)).toHaveLength(1);
    const runs = await db.prisma.backgroundJob.findMany({ where: { type: "DOCUMENT_TEXT_BACKFILL" } });
    expect(runs.map((r) => r.status)).toEqual(["DONE", "DONE"]);
    expect(await db.prisma.backgroundJob.count({ where: { status: { not: "DONE" } } })).toBe(0);
  });

  it("waits a minute between batches, and for the last batch's extractions to finish", async () => {
    await allFiledBeforeThisChange(Array.from({ length: 26 }, (_, i) => pdf(`numbat${i}x`)));
    vi.useFakeTimers({ toFake: ["Date"] });

    await enqueueJobUnlessPending("DOCUMENT_TEXT_BACKFILL");
    await runOneJob();
    // The next batch isn't due yet, and the 25 queued run first anyway.
    await drainJobs();
    expect(await db.prisma.vehicleItemDocument.count({ where: { extractionStatus: null } })).toBe(1);

    // Due, but one of this batch's extractions is still queued: it waits.
    await db.prisma.backgroundJob.updateMany({
      where: { type: "OCR_DOCUMENT", status: "DONE" },
      data: { status: "PENDING", availableAt: new Date(Date.now() + 3_600_000) },
    });
    vi.setSystemTime(Date.now() + 61_000);
    await runOneJob();
    expect(await db.prisma.vehicleItemDocument.count({ where: { extractionStatus: null } })).toBe(1);
  });

  it("runs below every other job, so a check queued after a batch isn't held up", async () => {
    await allFiledBeforeThisChange(Array.from({ length: 3 }, (_, i) => pdf(`bilby${i}x`)));
    await enqueueJobUnlessPending("DOCUMENT_TEXT_BACKFILL");
    await runOneJob();
    // Any job queued at normal priority after the batch; this one has no handler.
    const later = await db.prisma.backgroundJob.create({ data: { type: "TEST_NORMAL_PRIORITY", payload: "{}" } });

    await runOneJob();

    expect((await db.prisma.backgroundJob.findUniqueOrThrow({ where: { id: later.id } })).attempts).toBe(1);
    expect(await db.prisma.backgroundJob.count({ where: { type: "OCR_DOCUMENT", status: "PENDING" } })).toBe(3);
  });

  it("skips a Document in Trash, and picks it up once it's restored", async () => {
    const doc = await filedBeforeThisChange(pdf("replaced the timing belt"));
    await db.prisma.vehicleItemDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });

    await runBackfill();
    expect(extractTextDetailed).not.toHaveBeenCalled();

    await db.prisma.vehicleItemDocument.update({ where: { id: doc.id }, data: { deletedAt: null } });
    await runBackfill();
    expect((await documentHits("timing belt")).map((h) => h.title)).toEqual(["receipt.pdf"]);
  });

  it("settles a Word document without extracting it, so it isn't picked up again", async () => {
    await filedBeforeThisChange(docx("quote.docx"));

    await runBackfill();
    await runBackfill();

    expect(extractTextDetailed).not.toHaveBeenCalled();
    expect(await db.prisma.backgroundJob.count({ where: { type: "OCR_DOCUMENT" } })).toBe(0);
    expect(await db.prisma.backgroundJob.count({ where: { status: { not: "DONE" } } })).toBe(0);
  });

  it("picks up Documents of several kinds in one batch of 25", async () => {
    await allFiledBeforeThisChange(Array.from({ length: 20 }, (_, i) => pdf(`quoll${i}x`)));
    const prop = await db.prisma.property.create({ data: { label: "House", createdById: actorId } });
    const items = await db.prisma.homeItem.createManyAndReturn({
      data: Array.from({ length: 10 }, () => ({ propertyId: prop.id, type: "MAINTENANCE", title: "Gutters" })),
    });
    const homeRows = await oldDocumentFiles(
      "HOME_ITEM",
      items.map((item, i) => ({ file: pdf(`dunnart${i}x`), ownerId: item.id })),
    );
    await db.prisma.homeItemDocument.createMany({ data: homeRows.map(({ ownerId, ...d }) => ({ ...d, homeItemId: ownerId })) });

    await enqueueJobUnlessPending("DOCUMENT_TEXT_BACKFILL");
    await runOneJob();

    const jobs = await db.prisma.backgroundJob.findMany({ where: { type: "OCR_DOCUMENT" } });
    expect(jobs).toHaveLength(25);
    expect(new Set(jobs.map((j) => JSON.parse(j.payload).kind))).toEqual(new Set(["VEHICLE_ITEM", "HOME_ITEM"]));
    const left =
      (await db.prisma.vehicleItemDocument.count({ where: { extractionStatus: null } })) +
      (await db.prisma.homeItemDocument.count({ where: { extractionStatus: null } }));
    expect(left).toBe(5);
    await drainJobsOverTime();
    for (const word of ["quoll19x", "dunnart9x"]) expect(await documentHits(word)).toHaveLength(1);
  });

  it("with only pdftotext, reads PDFs but leaves images for when OCR is installed", async () => {
    vi.mocked(getExtractionCapabilities).mockResolvedValue(PDFTOTEXT_ONLY);
    const scan = await filedBeforeThisChange(pdf("replaced the timing belt"));
    const photo = await filedBeforeThisChange(png("odometer reads 84211"));

    await runBackfill();

    expect(await statusOf(scan.id)).toBe("COMPLETED");
    expect(await statusOf(photo.id)).toBeNull();
    expect(await documentHits("84211")).toEqual([]);
  });

  it("picks up a Document left PENDING an hour ago with nothing queued for it", async () => {
    const doc = await filedBeforeThisChange(pdf("replaced the timing belt"));
    await db.prisma.vehicleItemDocument.update({
      where: { id: doc.id },
      data: { extractionStatus: "PENDING", uploadedAt: new Date(Date.now() - 2 * 60 * 60_000) },
    });
    const recent = await filedBeforeThisChange(pdf("rotated the tyres"));
    await db.prisma.vehicleItemDocument.update({ where: { id: recent.id }, data: { extractionStatus: "PENDING" } });

    await runBackfill();

    expect((await documentHits("timing belt")).map((h) => h.title)).toEqual(["receipt.pdf"]);
    // Just filed: its job may be about to be queued, so it's left alone.
    expect(await statusOf(recent.id)).toBe("PENDING");
  });

  it("leaves an old PENDING Document alone while its job is still queued, waiting for a retry, or running", async () => {
    const docs = await allFiledBeforeThisChange(Array.from({ length: 3 }, () => pdf("replaced the timing belt")));
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000);
    const live = [
      { status: "PENDING" },
      { status: "PENDING", attempts: 1, availableAt: new Date(Date.now() + 3_600_000) },
      { status: "RUNNING", attempts: 1, leasedUntil: new Date(Date.now() + 3_600_000) },
    ];
    for (const [i, job] of live.entries()) {
      const doc = docs[i];
      await db.prisma.vehicleItemDocument.update({ where: { id: doc.id }, data: { extractionStatus: "PENDING", uploadedAt: twoHoursAgo } });
      // An upload's job: normal priority, the payload the Document command writes.
      await db.prisma.backgroundJob.create({
        data: {
          type: "OCR_DOCUMENT",
          payload: JSON.stringify({ kind: "VEHICLE_ITEM", id: doc.id, ownerId: doc.ownerId, storedName: doc.storedName, mimeType: doc.mimeType }),
          ...job,
        },
      });
    }

    await runDocumentTextBackfill();

    // Not released and queued a second time.
    for (const doc of docs) expect(await statusOf(doc.id)).toBe("PENDING");
    expect(await db.prisma.backgroundJob.count({ where: { type: "OCR_DOCUMENT" } })).toBe(3);
  });

  it("clears finished runs older than a week from the job table", async () => {
    const weekAgo = new Date(Date.now() - 8 * 24 * 60 * 60_000);
    const old = await Promise.all(
      ["DONE", "FAILED"].map((status) =>
        db.prisma.backgroundJob.create({ data: { type: "DOCUMENT_TEXT_BACKFILL", payload: "{}", status, finishedAt: weekAgo } }),
      ),
    );

    await runBackfill();

    for (const job of old) expect(await db.prisma.backgroundJob.findUnique({ where: { id: job.id } })).toBeNull();
    expect(await db.prisma.backgroundJob.count({ where: { type: "DOCUMENT_TEXT_BACKFILL", status: "DONE" } })).toBe(1);
  });

  it("is left to the server's own runner by POST /api/cron", async () => {
    await allFiledBeforeThisChange(Array.from({ length: 3 }, (_, i) => pdf(`potoroo${i}x`)));
    await enqueueJobUnlessPending("DOCUMENT_TEXT_BACKFILL");
    await runOneJob();
    vi.stubEnv("CRON_SECRET", "s3cret");
    try {
      const res = await cronPOST(
        new NextRequest("http://localhost/api/cron", { method: "POST", headers: { "x-cron-secret": "s3cret" } }),
      );
      expect(res.status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }

    expect(await db.prisma.backgroundJob.count({ where: { type: "OCR_DOCUMENT", status: "PENDING" } })).toBe(3);
    expect(await db.prisma.backgroundJob.count({ where: { type: "REMINDER_CHECK", status: "DONE" } })).toBe(1);
  });

  it("leaves a PDF alone while no PDF tools are installed, without queueing itself forever", async () => {
    const doc = await filedBeforeThisChange(pdf("replaced the timing belt"));
    vi.mocked(getExtractionCapabilities).mockResolvedValue(NO_TOOLS);

    await runBackfill();

    expect(await statusOf(doc.id)).toBeNull();
    expect(await db.prisma.backgroundJob.count({ where: { type: "OCR_DOCUMENT" } })).toBe(0);
    const runs = await db.prisma.backgroundJob.findMany({ where: { type: "DOCUMENT_TEXT_BACKFILL" } });
    expect(runs.map((r) => r.status)).toEqual(["DONE"]);
  });
});
