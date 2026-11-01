import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import {
  addDocumentCommand,
  deleteDocumentCommand,
  restoreDocumentCommand,
  permanentlyDeleteDocumentCommand,
  setDocumentImportantCommand,
  supersedeDocumentCommand,
  findDocument,
  findDocumentAnyKind,
  DocumentNotInTrashError,
} from "@/lib/commands/documents";
import {
  addDocumentAction,
  deleteDocumentAction,
  permanentlyDeleteDocumentAction,
  restoreDocumentAction,
  setDocumentImportantAction,
} from "@/lib/actions/documents";
import { attachInboxDocumentAsVersion } from "@/lib/actions/import";
import { auth } from "@/lib/auth";
import { queueDocumentExtraction } from "@/lib/documents/queueExtraction";
import { LIVE_DOCUMENT_WHERE } from "@/lib/documents/liveDocuments";
import { RecordNotFoundError } from "@/lib/commands/shared";
import { ModuleDisabledError } from "@/lib/modules/enablement";
import {
  DOCUMENT_KIND_MODULE,
  LEGACY_DOCUMENT_SYNC_ENTITIES,
  OWNED_DOCUMENT_KINDS,
  type OwnedDocumentKind,
} from "@/lib/documents/kinds";
import { getTrashEntries, purgeExpiredTrash, TRASH_RETENTION_DAYS } from "@/lib/trash";
import { getTrashedVersionLinks } from "@/lib/documents/trashedVersionLinks";
import { groupDocumentVersions } from "@/lib/documents/documentList";
import { ENTITY_SYNC_CONFIGS, normalizeSyncOperation } from "@/app/api/sync/entityHandlers";
import { GET as getDocumentFile } from "@/app/api/documents/[id]/route";
import { GET as getLegacyVehicleFile } from "@/app/api/vehicles/documents/[id]/route";
import { revalidatePath } from "next/cache";
import type { ModuleKey } from "@/lib/modules/registry";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// The file route checks for a session; every request here is signed in.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1", role: "MEMBER" } })) }));
vi.mock("@/lib/documents/queueExtraction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/documents/queueExtraction")>();
  return { ...actual, queueDocumentExtraction: vi.fn(actual.queueDocumentExtraction) };
});

const db = setupTestDb();

let actorId: string;

const OPT_IN_MODULES: ModuleKey[] = ["TRAVEL", "HOME", "VEHICLES", "INVENTORY", "WEALTH"];

beforeEach(async () => {
  vi.clearAllMocks();
  actorId = (await createTestUser()).id;
  for (const key of OPT_IN_MODULES) await setModuleEnabled(key, true);
});

// Where storage.ts keeps each kind's files, under UPLOADS_DIR.
const SUBDIR: Record<OwnedDocumentKind, string> = {
  CONTRACT: "",
  PRODUCT: "products",
  TRIP_SEGMENT: "trip-segments",
  RENTAL_STATEMENT: "rental-statements",
  HOME_ITEM: "home-items",
  VEHICLE_ITEM: "vehicle-items",
  INVENTORY_ITEM: "inventory-items",
  TRADE: "trades",
};

// Creates the record a Document of this kind is attached to, and returns
// its id plus the page that should be revalidated.
async function createOwner(kind: OwnedDocumentKind): Promise<{ ownerId: string; page: string }> {
  const p = db.prisma;
  switch (kind) {
    case "CONTRACT": {
      const c = await p.contract.create({
        data: { title: "Home insurance", category: "HOME_INSURANCE", provider: "Acme", createdById: actorId },
      });
      return { ownerId: c.id, page: `/contracts/${c.id}` };
    }
    case "PRODUCT": {
      const pr = await p.product.create({ data: { description: "Dishwasher", createdById: actorId } });
      return { ownerId: pr.id, page: `/products/${pr.id}` };
    }
    case "TRIP_SEGMENT": {
      const trip = await p.trip.create({ data: { title: "Japan", createdById: actorId } });
      const s = await p.tripSegment.create({ data: { tripId: trip.id, type: "FLIGHT", title: "SYD-NRT" } });
      return { ownerId: s.id, page: `/travel/${trip.id}` };
    }
    case "RENTAL_STATEMENT": {
      const prop = await p.property.create({ data: { label: "Unit 4", createdById: actorId } });
      const s = await p.rentalStatement.create({ data: { propertyId: prop.id } });
      return { ownerId: s.id, page: `/home/${prop.id}/rental` };
    }
    case "HOME_ITEM": {
      const prop = await p.property.create({ data: { label: "House", createdById: actorId } });
      const i = await p.homeItem.create({ data: { propertyId: prop.id, type: "REPAIR", title: "Roof" } });
      return { ownerId: i.id, page: `/home/${prop.id}` };
    }
    case "VEHICLE_ITEM": {
      const v = await p.vehicle.create({ data: { label: "Car", createdById: actorId } });
      const i = await p.vehicleItem.create({ data: { vehicleId: v.id, type: "SERVICE", title: "Service" } });
      return { ownerId: i.id, page: `/vehicles/${v.id}` };
    }
    case "INVENTORY_ITEM": {
      const i = await p.inventoryItem.create({ data: { label: "Camera", createdById: actorId } });
      return { ownerId: i.id, page: `/inventory/${i.id}` };
    }
    case "TRADE": {
      const pf = await p.portfolio.create({ data: { name: "Shares", createdById: actorId } });
      const h = await p.holding.create({ data: { portfolioId: pf.id, ticker: "VAS" } });
      const t = await p.trade.create({
        data: { holdingId: h.id, type: "BUY", date: new Date("2026-01-02"), units: 10, pricePerUnit: 90 },
      });
      return { ownerId: t.id, page: `/wealth/portfolios/${pf.id}/holdings/${h.id}` };
    }
  }
}

function pdf(name = "statement.pdf") {
  return new File(["%PDF-1.4\n% test document\n"], name, { type: "application/pdf" });
}

function filePath(kind: OwnedDocumentKind, ownerId: string, storedName: string) {
  return path.join(db.uploadsDir, SUBDIR[kind], ownerId, storedName);
}

async function exists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function fileRequest(id: string) {
  return new NextRequest(`http://localhost/api/documents/${id}`);
}

describe.each(OWNED_DOCUMENT_KINDS)("Document command: %s", (kind) => {
  it("adds: saves the file under its owner, creates the row, revalidates the owner's page", async () => {
    const { ownerId, page } = await createOwner(kind);
    const doc = await addDocumentCommand(kind, ownerId, { file: pdf(), category: "INVOICE" });

    expect(doc).toMatchObject({ kind, ownerId, filename: "statement.pdf", mimeType: "application/pdf", category: "INVOICE" });
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.storedName).not.toContain("statement");
    expect(await readFile(filePath(kind, ownerId, doc.storedName), "utf8")).toContain("%PDF-1.4");
    expect(await findDocument(kind, doc.id)).toMatchObject({ id: doc.id, deletedAt: null, isImportant: false });
    expect(revalidatePath).toHaveBeenCalledWith(page);
    expect(revalidatePath).toHaveBeenCalledWith("/documents");
  });

  it("refuses an owner that doesn't exist, writing nothing", async () => {
    await expect(addDocumentCommand(kind, "no-such-owner", { file: pdf() })).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(await exists(path.join(db.uploadsDir, SUBDIR[kind], "no-such-owner"))).toBe(false);
  });

  it("deletes to Trash (file kept), then restores", async () => {
    const { ownerId, page } = await createOwner(kind);
    const doc = await addDocumentCommand(kind, ownerId, { file: pdf() });

    await deleteDocumentCommand(kind, doc.id, { ownerId });
    expect((await findDocument(kind, doc.id))?.deletedAt).toBeInstanceOf(Date);
    expect(await exists(filePath(kind, ownerId, doc.storedName))).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/trash");

    const trash = await getTrashEntries();
    expect(trash).toContainEqual(
      expect.objectContaining({ id: doc.id, domain: "document", documentKind: kind, label: "statement.pdf" }),
    );

    vi.mocked(revalidatePath).mockClear();
    await restoreDocumentCommand(kind, doc.id);
    expect((await findDocument(kind, doc.id))?.deletedAt).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith(page);
    expect(await getTrashEntries()).not.toContainEqual(expect.objectContaining({ id: doc.id }));
  });

  it("refuses a delete scoped to a different owner", async () => {
    const { ownerId } = await createOwner(kind);
    const doc = await addDocumentCommand(kind, ownerId, { file: pdf() });
    await expect(deleteDocumentCommand(kind, doc.id, { ownerId: "someone-else" })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    expect((await findDocument(kind, doc.id))?.deletedAt).toBeNull();
  });

  it("permanently deletes: row and file go together", async () => {
    const { ownerId } = await createOwner(kind);
    const doc = await addDocumentCommand(kind, ownerId, { file: pdf() });
    await deleteDocumentCommand(kind, doc.id);

    await permanentlyDeleteDocumentCommand(kind, doc.id);
    expect(await findDocument(kind, doc.id)).toBeNull();
    expect(await exists(filePath(kind, ownerId, doc.storedName))).toBe(false);
  });

  it("stars and unstars", async () => {
    const { ownerId } = await createOwner(kind);
    const doc = await addDocumentCommand(kind, ownerId, { file: pdf() });
    await setDocumentImportantCommand(kind, doc.id, true);
    expect((await findDocument(kind, doc.id))?.isImportant).toBe(true);
    await setDocumentImportantCommand(kind, doc.id, false);
    expect((await findDocument(kind, doc.id))?.isImportant).toBe(false);
  });

  it("supersedes: a new version points at the chain's head and keeps the Document type", async () => {
    const { ownerId } = await createOwner(kind);
    const v1 = await addDocumentCommand(kind, ownerId, { file: pdf("v1.pdf"), category: "POLICY" });
    const v2 = await supersedeDocumentCommand(kind, v1.id, { file: pdf("v2.pdf") });
    expect(v2).toMatchObject({ ownerId, supersedesId: v1.id, category: "POLICY" });

    // Superseding the old version again lands on the head (supersedesId is unique).
    const v3 = await supersedeDocumentCommand(kind, v1.id, { file: pdf("v3.pdf") }, { ownerId });
    expect(v3.supersedesId).toBe(v2.id);
    expect(await exists(filePath(kind, ownerId, v3.storedName))).toBe(true);
  });

  it("lists the version links of Documents in Trash, so the list keeps one Document (#397)", async () => {
    const { ownerId } = await createOwner(kind);
    const v1 = await addDocumentCommand(kind, ownerId, { file: pdf("v1.pdf") });
    await setDocumentImportantCommand(kind, v1.id, true);
    const v2 = await supersedeDocumentCommand(kind, v1.id, { file: pdf("v2.pdf") });
    const v3 = await supersedeDocumentCommand(kind, v2.id, { file: pdf("v3.pdf") });
    // A new version doesn't carry the star over.
    expect(v2.isImportant).toBe(false);

    await deleteDocumentCommand(kind, v3.id);
    const v4 = await supersedeDocumentCommand(kind, v2.id, { file: pdf("v4.pdf") });
    expect(v4.supersedesId).toBe(v3.id);

    const links = await getTrashedVersionLinks(kind, [ownerId, "no-such-owner"]);
    expect(links.get(ownerId)).toEqual([{ id: v3.id, supersedesId: v2.id }]);
    expect(links.has("no-such-owner")).toBe(false);

    const live = [v4, v2, (await findDocument(kind, v1.id))!];
    const groups = groupDocumentVersions(live, links.get(ownerId));
    expect(groups.map((g) => g.latest.id)).toEqual([v4.id]);
    expect(groups[0].older.map((d) => [d.id, d.isImportant])).toEqual([
      [v2.id, false],
      [v1.id, true],
    ]);
  });

  it("serves the file from /api/documents/[id] with the download headers", async () => {
    const { ownerId } = await createOwner(kind);
    const doc = await addDocumentCommand(kind, ownerId, { file: pdf('a "quoted" name.pdf') });

    const res = await getDocumentFile(fileRequest(doc.id), { params: Promise.resolve({ id: doc.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="a _quoted_ name.pdf"');
    expect(res.headers.get("Content-Length")).toBe(String(doc.size));
    expect(await res.text()).toContain("%PDF-1.4");

    await deleteDocumentCommand(kind, doc.id);
    const trashed = await getDocumentFile(fileRequest(doc.id), { params: Promise.resolve({ id: doc.id }) });
    expect(trashed.status).toBe(404);
  });

  const moduleKey = DOCUMENT_KIND_MODULE[kind];
  if (moduleKey) {
    it(`is gated on the ${moduleKey} module: commands refuse and the file route 404s`, async () => {
      const { ownerId } = await createOwner(kind);
      const doc = await addDocumentCommand(kind, ownerId, { file: pdf() });
      await setModuleEnabled(moduleKey, false);

      await expect(addDocumentCommand(kind, ownerId, { file: pdf() })).rejects.toBeInstanceOf(ModuleDisabledError);
      await expect(deleteDocumentCommand(kind, doc.id)).rejects.toBeInstanceOf(ModuleDisabledError);
      await expect(restoreDocumentCommand(kind, doc.id)).rejects.toBeInstanceOf(ModuleDisabledError);
      await expect(setDocumentImportantCommand(kind, doc.id, true)).rejects.toBeInstanceOf(ModuleDisabledError);
      await expect(supersedeDocumentCommand(kind, doc.id, { file: pdf() })).rejects.toBeInstanceOf(ModuleDisabledError);
      await expect(permanentlyDeleteDocumentCommand(kind, doc.id)).rejects.toBeInstanceOf(ModuleDisabledError);

      const res = await getDocumentFile(fileRequest(doc.id), { params: Promise.resolve({ id: doc.id }) });
      expect(res.status).toBe(404);
      expect(await findDocument(kind, doc.id)).toMatchObject({ deletedAt: null });
    });
  } else {
    it("is always on: works with every opt-in module off", async () => {
      for (const key of OPT_IN_MODULES) await setModuleEnabled(key, false);
      const { ownerId } = await createOwner(kind);
      const doc = await addDocumentCommand(kind, ownerId, { file: pdf() });
      await deleteDocumentCommand(kind, doc.id);
      await restoreDocumentCommand(kind, doc.id);
      const res = await getDocumentFile(fileRequest(doc.id), { params: Promise.resolve({ id: doc.id }) });
      expect(res.status).toBe(200);
    });
  }

  it("syncs an offline delete in the new shape (entity document + kind) to Trash", async () => {
    const { ownerId } = await createOwner(kind);
    const doc = await addDocumentCommand(kind, ownerId, { file: pdf() });
    const op = normalizeSyncOperation({ entity: "document", kind, parentId: ownerId });
    await ENTITY_SYNC_CONFIGS[op.entity].remove!(doc.id, { userId: actorId, parentId: op.parentId, kind: op.kind });
    expect((await findDocument(kind, doc.id))?.deletedAt).toBeInstanceOf(Date);
  });
});

describe("Sync: offline deletes queued before #396", () => {
  it.each(Object.entries(LEGACY_DOCUMENT_SYNC_ENTITIES))(
    "maps %s onto the document entity and moves it to Trash",
    async (legacyEntity, { kind }) => {
      const { ownerId } = await createOwner(kind);
      const doc = await addDocumentCommand(kind, ownerId, { file: pdf() });
      // A legacy tradeDocument op carried the Holding as its parent.
      const parentId =
        kind === "TRADE"
          ? (await db.prisma.trade.findUniqueOrThrow({ where: { id: ownerId } })).holdingId
          : ownerId;

      const op = normalizeSyncOperation<{ entity: string; parentId?: string; kind?: string }>({
        entity: legacyEntity,
        parentId,
      });
      expect(op.entity).toBe("document");
      expect(op.kind).toBe(kind);
      await ENTITY_SYNC_CONFIGS[op.entity].remove!(doc.id, { userId: actorId, parentId: op.parentId, kind: op.kind });

      const row = await findDocument(kind, doc.id);
      expect(row?.deletedAt).toBeInstanceOf(Date);
      expect(await exists(filePath(kind, ownerId, doc.storedName))).toBe(true);
    },
  );

  it("leaves other entities alone", () => {
    const op = { entity: "vehicle", parentId: "x" };
    expect(normalizeSyncOperation(op)).toBe(op);
  });

  it("resolves the kind from the id when a document op has none", async () => {
    const { ownerId } = await createOwner("TRIP_SEGMENT");
    const doc = await addDocumentCommand("TRIP_SEGMENT", ownerId, { file: pdf() });
    await ENTITY_SYNC_CONFIGS.document.remove!(doc.id, { userId: actorId });
    expect((await findDocument("TRIP_SEGMENT", doc.id))?.deletedAt).toBeInstanceOf(Date);
  });
});

describe("Document file routes", () => {
  it("redirects an old per-module URL to /api/documents/[id]", async () => {
    const res = await getLegacyVehicleFile(new NextRequest("http://localhost/api/vehicles/documents/abc"), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("/api/documents/abc");
  });

  it("404s an unknown id", async () => {
    const res = await getDocumentFile(fileRequest("nope"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("404s a Document whose record is in Trash", async () => {
    const { ownerId } = await createOwner("VEHICLE_ITEM");
    const doc = await addDocumentCommand("VEHICLE_ITEM", ownerId, { file: pdf() });
    const item = await db.prisma.vehicleItem.findUniqueOrThrow({ where: { id: ownerId } });
    await db.prisma.vehicle.update({ where: { id: item.vehicleId }, data: { deletedAt: new Date() } });
    const res = await getDocumentFile(fileRequest(doc.id), { params: Promise.resolve({ id: doc.id }) });
    expect(res.status).toBe(404);
  });

  it("finds a Document by id alone, whatever its kind", async () => {
    const { ownerId } = await createOwner("RENTAL_STATEMENT");
    const doc = await addDocumentCommand("RENTAL_STATEMENT", ownerId, { file: pdf() });
    expect(await findDocumentAnyKind(doc.id)).toMatchObject({ kind: "RENTAL_STATEMENT", ownerId });
  });
});

describe("Trash retention", () => {
  it("purges expired Documents of every kind, files included", async () => {
    const old = new Date(Date.now() - (TRASH_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    const docs = [];
    for (const kind of OWNED_DOCUMENT_KINDS) {
      const { ownerId } = await createOwner(kind);
      const expired = await addDocumentCommand(kind, ownerId, { file: pdf() });
      const recent = await addDocumentCommand(kind, ownerId, { file: pdf() });
      await deleteDocumentCommand(kind, expired.id);
      await deleteDocumentCommand(kind, recent.id);
      docs.push({ kind, expired, recent });
    }
    // Backdate the expired ones past the retention window.
    const backdate = { where: { id: { in: docs.map((d) => d.expired.id) } }, data: { deletedAt: old } };
    await Promise.all([
      db.prisma.document.updateMany(backdate),
      db.prisma.productDocument.updateMany(backdate),
      db.prisma.tripSegmentDocument.updateMany(backdate),
      db.prisma.rentalStatementDocument.updateMany(backdate),
      db.prisma.homeItemDocument.updateMany(backdate),
      db.prisma.vehicleItemDocument.updateMany(backdate),
      db.prisma.inventoryItemDocument.updateMany(backdate),
      db.prisma.tradeDocument.updateMany(backdate),
    ]);

    await purgeExpiredTrash();

    for (const { kind, expired, recent } of docs) {
      expect(await findDocument(kind, expired.id), kind).toBeNull();
      expect(await exists(filePath(kind, expired.ownerId, expired.storedName)), kind).toBe(false);
      expect(await findDocument(kind, recent.id), kind).not.toBeNull();
      expect(await exists(filePath(kind, recent.ownerId, recent.storedName)), kind).toBe(true);
    }
  });
});

describe("Review follow-ups", () => {
  it("a delete of a Document already in Trash keeps its original deletedAt", async () => {
    const { ownerId } = await createOwner("TRADE");
    const doc = await addDocumentCommand("TRADE", ownerId, { file: pdf() });
    await deleteDocumentCommand("TRADE", doc.id);
    const first = (await findDocument("TRADE", doc.id))!.deletedAt!;
    await new Promise((r) => setTimeout(r, 5));
    await deleteDocumentCommand("TRADE", doc.id);
    expect((await findDocument("TRADE", doc.id))!.deletedAt!.getTime()).toBe(first.getTime());
  });

  it("a replayed sync delete of an already-purged Document succeeds", async () => {
    const { ownerId } = await createOwner("RENTAL_STATEMENT");
    const doc = await addDocumentCommand("RENTAL_STATEMENT", ownerId, { file: pdf() });
    await deleteDocumentCommand("RENTAL_STATEMENT", doc.id);
    await permanentlyDeleteDocumentCommand("RENTAL_STATEMENT", doc.id);
    await expect(
      ENTITY_SYNC_CONFIGS.document.remove!(doc.id, { userId: actorId, kind: "RENTAL_STATEMENT", parentId: ownerId }),
    ).resolves.toBeUndefined();
    await expect(ENTITY_SYNC_CONFIGS.document.remove!(doc.id, { userId: actorId })).resolves.toBeUndefined();
  });

  it("refuses a permanent delete of a Document that isn't in Trash", async () => {
    const { ownerId } = await createOwner("CONTRACT");
    const doc = await addDocumentCommand("CONTRACT", ownerId, { file: pdf() });
    await expect(permanentlyDeleteDocumentCommand("CONTRACT", doc.id)).rejects.toBeInstanceOf(DocumentNotInTrashError);
    expect(await exists(filePath("CONTRACT", ownerId, doc.storedName))).toBe(true);
  });

  it("files the Document even if queueing text extraction fails", async () => {
    vi.mocked(queueDocumentExtraction).mockRejectedValueOnce(new Error("job table locked"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ownerId } = await createOwner("CONTRACT");
    const doc = await addDocumentCommand("CONTRACT", ownerId, { file: pdf() });
    expect(await findDocument("CONTRACT", doc.id)).not.toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("Trash leaves out Documents of a module that's turned off", async () => {
    const { ownerId } = await createOwner("TRIP_SEGMENT");
    const doc = await addDocumentCommand("TRIP_SEGMENT", ownerId, { file: pdf() });
    await deleteDocumentCommand("TRIP_SEGMENT", doc.id);
    await setModuleEnabled("TRAVEL", false);
    expect(await getTrashEntries()).not.toContainEqual(expect.objectContaining({ id: doc.id }));
    await setModuleEnabled("TRAVEL", true);
    expect(await getTrashEntries()).toContainEqual(expect.objectContaining({ id: doc.id }));
  });

  // The where used by /documents and the dashboard's Document counts.
  it.each(OWNED_DOCUMENT_KINDS.filter((k) => k !== "TRADE"))(
    "LIVE_DOCUMENT_WHERE leaves out a %s Document whose record is in Trash",
    async (kind) => {
      const { ownerId } = await createOwner(kind);
      const doc = await addDocumentCommand(kind, ownerId, { file: pdf() });
      const p = db.prisma;
      const now = new Date();
      const trashOwner: Record<Exclude<OwnedDocumentKind, "TRADE">, () => Promise<unknown>> = {
        CONTRACT: () => p.contract.update({ where: { id: ownerId }, data: { deletedAt: now } }),
        PRODUCT: () => p.product.update({ where: { id: ownerId }, data: { deletedAt: now } }),
        TRIP_SEGMENT: async () => {
          const s = await p.tripSegment.findUniqueOrThrow({ where: { id: ownerId } });
          await p.trip.update({ where: { id: s.tripId }, data: { deletedAt: now } });
        },
        RENTAL_STATEMENT: async () => {
          const s = await p.rentalStatement.findUniqueOrThrow({ where: { id: ownerId } });
          await p.property.update({ where: { id: s.propertyId }, data: { deletedAt: now } });
        },
        HOME_ITEM: async () => {
          const i = await p.homeItem.findUniqueOrThrow({ where: { id: ownerId } });
          await p.property.update({ where: { id: i.propertyId }, data: { deletedAt: now } });
        },
        VEHICLE_ITEM: () => p.vehicleItem.update({ where: { id: ownerId }, data: { deletedAt: now } }),
        INVENTORY_ITEM: () => p.inventoryItem.update({ where: { id: ownerId }, data: { deletedAt: now } }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegates: Record<OwnedDocumentKind, any> = {
        CONTRACT: p.document,
        PRODUCT: p.productDocument,
        TRIP_SEGMENT: p.tripSegmentDocument,
        RENTAL_STATEMENT: p.rentalStatementDocument,
        HOME_ITEM: p.homeItemDocument,
        VEHICLE_ITEM: p.vehicleItemDocument,
        INVENTORY_ITEM: p.inventoryItemDocument,
        TRADE: p.tradeDocument,
      };
      const where = { ...LIVE_DOCUMENT_WHERE[kind], id: doc.id };
      expect(await delegates[kind].count({ where })).toBe(1);
      await trashOwner[kind as Exclude<OwnedDocumentKind, "TRADE">]();
      expect(await delegates[kind].count({ where })).toBe(0);
    },
  );
});

describe("Document actions", () => {
  function upload(file = pdf()) {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("documentCategory", "RECEIPT");
    return fd;
  }

  it("refuses a READONLY member", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "READONLY" } } as never);
    try {
      const { ownerId } = await createOwner("CONTRACT");
      await expect(addDocumentAction("CONTRACT", ownerId, null, upload())).rejects.toThrow("read-only");
      await expect(deleteDocumentAction("CONTRACT", "x")).rejects.toThrow("read-only");
      await expect(restoreDocumentAction("CONTRACT", "x")).rejects.toThrow("read-only");
      await expect(permanentlyDeleteDocumentAction("CONTRACT", "x")).rejects.toThrow("read-only");
      await expect(setDocumentImportantAction("CONTRACT", "x", true)).rejects.toThrow("read-only");
      expect(await db.prisma.document.count()).toBe(0);
    } finally {
      vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "MEMBER" } } as never);
    }
  });

  it("refuses a kind that isn't a Document kind", async () => {
    await expect(deleteDocumentAction("INBOX" as OwnedDocumentKind, "x")).rejects.toThrow("Unknown document kind");
    await expect(addDocumentAction("NOPE" as OwnedDocumentKind, "x", null, upload())).rejects.toThrow(
      "Unknown document kind",
    );
    expect(await attachInboxDocumentAsVersion("x", "TRADE" as never, "o", "d")).toEqual({
      error: "Document not found.",
    });
  });

  it("maps command errors to ActionState", async () => {
    expect(await deleteDocumentAction("CONTRACT", "missing")).toEqual({ error: "Document not found." });
    expect(await addDocumentAction("PRODUCT", "missing", null, upload())).toEqual({ error: "Warranty not found." });

    const { ownerId } = await createOwner("CONTRACT");
    const bad = await addDocumentAction(
      "CONTRACT",
      ownerId,
      null,
      upload(new File(["not a pdf"], "x.pdf", { type: "application/pdf" })),
    );
    expect(bad?.error).toMatch(/don't match|labelled/);

    expect(await addDocumentAction("CONTRACT", ownerId, null, upload())).toEqual({ success: "Document uploaded." });
    const [row] = await db.prisma.document.findMany({ where: { contractId: ownerId } });
    expect(row.category).toBe("RECEIPT");
    expect(await permanentlyDeleteDocumentAction("CONTRACT", row.id)).toEqual({
      error: "Only a document in Recently deleted can be deleted permanently.",
    });
    expect(await deleteDocumentAction("CONTRACT", row.id, ownerId)).toEqual({ success: "Document deleted." });
    expect(await permanentlyDeleteDocumentAction("CONTRACT", row.id)).toEqual({ success: "Deleted permanently." });

    await setModuleEnabled("TRAVEL", false);
    expect(await restoreDocumentAction("TRIP_SEGMENT", "x")).toEqual({ error: "Travel module is disabled" });
  });

  it("derives a Product Document's legacy kind from its Document type", async () => {
    const { ownerId } = await createOwner("PRODUCT");
    await addDocumentAction("PRODUCT", ownerId, null, upload());
    const [row] = await db.prisma.productDocument.findMany({ where: { productId: ownerId } });
    expect(row).toMatchObject({ kind: "INVOICE", category: "RECEIPT" });
  });
});
