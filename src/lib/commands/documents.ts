import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { documentStoreFor } from "@/lib/storage";
import { assertModuleEnabled } from "@/lib/modules/enablement";
import {
  requireLive,
  assertParentRestored,
  RecordNotFoundError,
  type Trashable,
} from "@/lib/commands/shared";
import { queueDocumentExtraction } from "@/lib/documents/queueExtraction";
import { getDocumentVersionChain } from "@/lib/documents/documentQueries";
import { DOCUMENT_KIND_MODULE, OWNED_DOCUMENT_KINDS, type OwnedDocumentKind } from "@/lib/documents/kinds";
import { ProductDocumentKind } from "@/generated/prisma/enums";
import { syncLegacyDocument, removeStagedLegacyDocument } from "@/lib/items/syncLegacyDocument";

async function mirrorStagedDocument(kind: OwnedDocumentKind, id: string) {
  if (kind !== "PRODUCT" && kind !== "INVENTORY_ITEM") return;
  try { await syncLegacyDocument(kind, id); }
  catch (error) { console.error("[items] couldn't mirror %s Document %s", kind, id, error); }
}

// The Document command (#396, ADR 0003). Every write to a Document of any
// kind goes through here: server actions, the offline sync handler, import,
// the Inbox and Trash retention. The 8 owner tables stay separate (each
// keeps its own foreign key and cascade); this module is the one place that
// knows how to reach each of them. Callers own sign-in, role checks and
// input parsing; these own the module gate, the write, file cleanup and
// revalidation.
//
// A Document follows the Trash rules in shared.ts (#428): one can't be added
// (or a new version filed) under a record in Trash, or under one whose
// parent is in Trash, and one in Trash can't be restored while its record
// or that record's parent still is.

/** One Document row, whichever table it lives in. */
/** A permanent delete was asked for a Document that isn't in Trash. */
export class DocumentNotInTrashError extends Error {
  constructor() {
    super("Move the document to Trash before deleting it permanently.");
    this.name = "DocumentNotInTrashError";
  }
}

export interface DocumentRecord {
  kind: OwnedDocumentKind;
  id: string;
  ownerId: string;
  filename: string;
  storedName: string;
  mimeType: string;
  size: number;
  sha256: string | null;
  category: string | null;
  isImportant: boolean;
  supersedesId: string | null;
  deletedAt: Date | null;
  uploadedAt: Date;
}

export interface AddDocumentInput {
  file: File;
  /** Document type (src/lib/documents/categories.ts); null for none. */
  category?: string | null;
  /** Overrides the stored display name; defaults to the file's own name. */
  filename?: string;
  /** PRODUCT only: the legacy Product document kind. Defaults to OTHER. */
  productKind?: ProductDocumentKind;
  /**
   * CONTRACT/PRODUCT only: text already extracted elsewhere (the Inbox),
   * so the extraction job isn't queued again. Null or omitted queues it.
   */
  extractedText?: string | null;
}

// One record a Document hangs off, and whether it's in Trash.
interface TrashLink extends Trashable {
  label: string;
}

interface OwnerInfo {
  // Pages that show this owner's Documents, revalidated after every write.
  paths: string[];
  // The owner record and the record it belongs to (if it has a Trash),
  // outermost first. While any of them is in Trash the owner's Documents
  // aren't served even though their own rows are live, nothing is added
  // under it, and none of them is restored.
  chain: TrashLink[];
}

function ownerInTrash(owner: OwnerInfo) {
  return owner.chain.some((link) => !!link.deletedAt);
}

// Each of the 8 Prisma delegates has its own generated arg/return types,
// which can't be unified without restating them all here; the same tradeoff
// documentQueries.ts makes. Only the columns every table shares are used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Delegate = any;

interface KindConfig {
  ownerField: string;
  ownerLabel: string;
  delegate: () => Delegate;
  loadOwner: (ownerId: string) => Promise<OwnerInfo | null>;
  // Extra columns for a new row, and what to do once it exists.
  createData?: (input: AddDocumentInput) => Record<string, unknown>;
  afterCreate?: (doc: DocumentRecord, input: AddDocumentInput) => Promise<void>;
}

const KINDS: Record<OwnedDocumentKind, KindConfig> = {
  CONTRACT: {
    ownerField: "contractId",
    ownerLabel: "Contract",
    delegate: () => prisma.document,
    loadOwner: async (id) => {
      const c = await prisma.contract.findUnique({ where: { id }, select: { deletedAt: true } });
      return c && { paths: [`/contracts/${id}`], chain: [{ label: "Contract", deletedAt: c.deletedAt }] };
    },
    createData: (input) =>
      input.extractedText != null
        ? { extractedText: input.extractedText, extractionStatus: "COMPLETED" }
        : { extractionStatus: "PENDING" },
    afterCreate: async (doc, input) => {
      if (input.extractedText != null) return;
      await queueDocumentExtraction({
        kind: "contract",
        id: doc.id,
        ownerId: doc.ownerId,
        storedName: doc.storedName,
        mimeType: doc.mimeType,
      });
    },
  },
  PRODUCT: {
    ownerField: "productId",
    ownerLabel: "Warranty",
    delegate: () => prisma.productDocument,
    loadOwner: async (id) => {
      const p = await prisma.product.findUnique({ where: { id }, select: { deletedAt: true } });
      return p && { paths: [`/products/${id}`], chain: [{ label: "Warranty", deletedAt: p.deletedAt }] };
    },
    // Only invoices carry meaningful text; plain product photos skip OCR.
    createData: (input) => {
      const kind = input.productKind ?? ProductDocumentKind.OTHER;
      if (input.extractedText != null) {
        return { kind, extractedText: input.extractedText, extractionStatus: "COMPLETED" };
      }
      return { kind, extractionStatus: kind === ProductDocumentKind.INVOICE ? "PENDING" : "COMPLETED" };
    },
    afterCreate: async (doc, input) => {
      if (input.extractedText != null || input.productKind !== ProductDocumentKind.INVOICE) return;
      await queueDocumentExtraction({
        kind: "product",
        id: doc.id,
        ownerId: doc.ownerId,
        storedName: doc.storedName,
        mimeType: doc.mimeType,
      });
    },
  },
  TRIP_SEGMENT: {
    ownerField: "tripSegmentId",
    ownerLabel: "Segment",
    delegate: () => prisma.tripSegmentDocument,
    loadOwner: async (id) => {
      const s = await prisma.tripSegment.findUnique({
        where: { id },
        select: { tripId: true, trip: { select: { deletedAt: true } } },
      });
      // Segments have no Trash of their own; their Trip does.
      return s && { paths: [`/travel/${s.tripId}`], chain: [{ label: "Trip", deletedAt: s.trip.deletedAt }] };
    },
  },
  RENTAL_STATEMENT: {
    ownerField: "rentalStatementId",
    ownerLabel: "Statement",
    delegate: () => prisma.rentalStatementDocument,
    loadOwner: async (id) => {
      const s = await prisma.rentalStatement.findUnique({
        where: { id },
        select: { propertyId: true, property: { select: { deletedAt: true } } },
      });
      return (
        s && { paths: [`/home/${s.propertyId}/rental`], chain: [{ label: "Property", deletedAt: s.property.deletedAt }] }
      );
    },
  },
  HOME_ITEM: {
    ownerField: "homeItemId",
    ownerLabel: "Maintenance record",
    delegate: () => prisma.homeItemDocument,
    loadOwner: async (id) => {
      const i = await prisma.homeItem.findUnique({
        where: { id },
        select: { propertyId: true, deletedAt: true, property: { select: { deletedAt: true } } },
      });
      return (
        i && {
          paths: [`/home/${i.propertyId}`],
          chain: [
            { label: "Property", deletedAt: i.property.deletedAt },
            { label: "Maintenance record", deletedAt: i.deletedAt },
          ],
        }
      );
    },
  },
  VEHICLE_ITEM: {
    ownerField: "vehicleItemId",
    ownerLabel: "Service record",
    delegate: () => prisma.vehicleItemDocument,
    loadOwner: async (id) => {
      const i = await prisma.vehicleItem.findUnique({
        where: { id },
        select: { vehicleId: true, deletedAt: true, vehicle: { select: { deletedAt: true } } },
      });
      return (
        i && {
          paths: [`/vehicles/${i.vehicleId}`],
          chain: [
            { label: "Vehicle", deletedAt: i.vehicle.deletedAt },
            { label: "Service record", deletedAt: i.deletedAt },
          ],
        }
      );
    },
  },
  INVENTORY_ITEM: {
    ownerField: "inventoryItemId",
    ownerLabel: "Item",
    delegate: () => prisma.inventoryItemDocument,
    loadOwner: async (id) => {
      const i = await prisma.inventoryItem.findUnique({ where: { id }, select: { deletedAt: true } });
      return i && { paths: [`/inventory/${id}`], chain: [{ label: "Inventory item", deletedAt: i.deletedAt }] };
    },
  },
  TRADE: {
    ownerField: "tradeId",
    ownerLabel: "Trade",
    delegate: () => prisma.tradeDocument,
    // Portfolios, Holdings and Trades have no Trash.
    loadOwner: async (id) => {
      const t = await prisma.trade.findUnique({
        where: { id },
        select: { holdingId: true, holding: { select: { portfolioId: true } } },
      });
      return t && { paths: [`/wealth/portfolios/${t.holding.portfolioId}/holdings/${t.holdingId}`], chain: [] };
    },
  },
};

const ROW_SELECT_BASE = {
  id: true,
  filename: true,
  storedName: true,
  mimeType: true,
  size: true,
  sha256: true,
  category: true,
  isImportant: true,
  supersedesId: true,
  deletedAt: true,
  uploadedAt: true,
} as const;

function rowSelect(kind: OwnedDocumentKind) {
  return { ...ROW_SELECT_BASE, [KINDS[kind].ownerField]: true };
}

function toRecord(kind: OwnedDocumentKind, row: Record<string, unknown>): DocumentRecord {
  return {
    kind,
    id: row.id as string,
    ownerId: row[KINDS[kind].ownerField] as string,
    filename: row.filename as string,
    storedName: row.storedName as string,
    mimeType: row.mimeType as string,
    size: row.size as number,
    sha256: (row.sha256 as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    isImportant: row.isImportant as boolean,
    supersedesId: (row.supersedesId as string | null) ?? null,
    deletedAt: (row.deletedAt as Date | null) ?? null,
    uploadedAt: row.uploadedAt as Date,
  };
}

async function gate(kind: OwnedDocumentKind) {
  const key = DOCUMENT_KIND_MODULE[kind];
  if (key) await assertModuleEnabled(key);
}

function revalidate(paths: string[]) {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/documents");
}

async function ownerPaths(kind: OwnedDocumentKind, ownerId: string): Promise<string[]> {
  return (await KINDS[kind].loadOwner(ownerId))?.paths ?? [];
}

export interface DocumentScope {
  // When given, the Document must belong to this owner record, otherwise
  // it's reported as not found (the URL-scoped check the lists rely on).
  ownerId?: string;
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** A Document of a known kind, or null. No module gate: callers decide. */
export async function findDocument(kind: OwnedDocumentKind, id: string): Promise<DocumentRecord | null> {
  const row = await KINDS[kind].delegate().findUnique({ where: { id }, select: rowSelect(kind) });
  return row ? toRecord(kind, row) : null;
}

/**
 * Finds a Document by id alone, whichever table it's in. Ids are cuids, so
 * at most one table can match.
 */
export async function findDocumentAnyKind(id: string): Promise<DocumentRecord | null> {
  const found = await Promise.all(OWNED_DOCUMENT_KINDS.map((kind) => findDocument(kind, id)));
  return found.find((doc): doc is DocumentRecord => doc !== null) ?? null;
}

/** Whether the record a Document is attached to (or that record's parent) is in Trash. */
export async function isDocumentOwnerInTrash(doc: DocumentRecord): Promise<boolean> {
  const owner = await KINDS[doc.kind].loadOwner(doc.ownerId);
  return !owner || ownerInTrash(owner);
}

async function requireDocument(kind: OwnedDocumentKind, id: string, scope: DocumentScope = {}) {
  const doc = await findDocument(kind, id);
  if (!doc || (scope.ownerId !== undefined && doc.ownerId !== scope.ownerId)) {
    throw new RecordNotFoundError("Document");
  }
  return doc;
}

// ── Writes ──────────────────────────────────────────────────────────────────

async function insertDocument(
  kind: OwnedDocumentKind,
  ownerId: string,
  input: AddDocumentInput,
  supersedesId: string | null,
): Promise<DocumentRecord> {
  const config = KINDS[kind];
  const owner = await config.loadOwner(ownerId);
  if (!owner) throw new RecordNotFoundError(config.ownerLabel);
  // An owner in Trash, or under a parent in Trash, counts as not found.
  for (const link of owner.chain) requireLive(link, config.ownerLabel);

  // Throws UploadRejectedError for an empty, oversized or mislabelled file.
  const store = documentStoreFor(kind);
  const { storedName, size, sha256, mimeType } = await store.save(ownerId, input.file);
  let doc: DocumentRecord;
  try {
    const row = await config.delegate().create({
      data: {
        [config.ownerField]: ownerId,
        filename: (input.filename ?? input.file.name).slice(0, 255),
        storedName,
        mimeType,
        size,
        sha256,
        category: input.category ?? null,
        supersedesId,
        ...config.createData?.(input),
      },
      select: rowSelect(kind),
    });
    doc = toRecord(kind, row);
  } catch (error) {
    // Keep file and row paired: no row, so no file either.
    await store.remove(ownerId, storedName);
    throw error;
  }
  // Best effort: the Document is filed either way, and a caller that fell
  // back to the Inbox on an error here would file the same file twice.
  try {
    await config.afterCreate?.(doc, input);
  } catch (error) {
    console.error(`[documents] couldn't queue text extraction for ${kind} document ${doc.id}`, error);
  }
  await mirrorStagedDocument(kind, doc.id);
  revalidate(owner.paths);
  return doc;
}

/** Saves the file under its owner and creates the Document row. */
export async function addDocumentCommand(
  kind: OwnedDocumentKind,
  ownerId: string,
  input: AddDocumentInput,
): Promise<DocumentRecord> {
  await gate(kind);
  return insertDocument(kind, ownerId, input, null);
}

/**
 * Adds a newer version of an existing Document, on the same owner. The new
 * one supersedes the chain's current head, which may not be `documentId`
 * itself if that was already replaced (supersedesId is unique per table).
 * The Document type carries over unless a new one is given.
 */
export async function supersedeDocumentCommand(
  kind: OwnedDocumentKind,
  documentId: string,
  input: AddDocumentInput,
  scope: DocumentScope = {},
): Promise<DocumentRecord> {
  await gate(kind);
  const target = await requireDocument(kind, documentId, scope);
  const chain = await getDocumentVersionChain(kind, documentId);
  const headId = chain.length > 0 ? chain[chain.length - 1].id : target.id;
  const head = headId === target.id ? target : ((await findDocument(kind, headId)) ?? target);
  return insertDocument(
    kind,
    target.ownerId,
    { ...input, category: input.category !== undefined ? input.category : head.category },
    head.id,
  );
}

/**
 * Soft delete: moves the Document to Trash. File and row stay until it's
 * purged. Already in Trash is a no-op, so a replayed delete doesn't restart
 * its 30 days.
 */
export async function deleteDocumentCommand(kind: OwnedDocumentKind, id: string, scope: DocumentScope = {}) {
  await gate(kind);
  const doc = await requireDocument(kind, id, scope);
  if (doc.deletedAt) return;
  await KINDS[kind].delegate().update({ where: { id }, data: { deletedAt: new Date() } });
  await mirrorStagedDocument(kind, id);
  revalidate(await ownerPaths(kind, doc.ownerId));
  revalidatePath("/settings/trash");
}

export async function restoreDocumentCommand(kind: OwnedDocumentKind, id: string) {
  await gate(kind);
  const doc = await requireDocument(kind, id);
  const owner = await KINDS[kind].loadOwner(doc.ownerId);
  // Outermost first, so the message names what to restore first.
  for (const link of owner?.chain ?? []) assertParentRestored(link, link.label);
  await KINDS[kind].delegate().update({ where: { id }, data: { deletedAt: null } });
  await mirrorStagedDocument(kind, id);
  revalidate(owner?.paths ?? []);
  revalidatePath("/settings/trash");
}

/** Only from Trash: a live Document has to be deleted to Trash first. */
export async function permanentlyDeleteDocumentCommand(kind: OwnedDocumentKind, id: string) {
  await gate(kind);
  const doc = await requireDocument(kind, id);
  if (!doc.deletedAt) throw new DocumentNotInTrashError();
  const { ownerId } = await purgeDocument(kind, id);
  revalidate(await ownerPaths(kind, ownerId));
  revalidatePath("/settings/trash");
}

/** Stars or unstars a Document (isImportant). */
export async function setDocumentImportantCommand(
  kind: OwnedDocumentKind,
  id: string,
  isImportant: boolean,
  scope: DocumentScope = {},
) {
  await gate(kind);
  const doc = await requireDocument(kind, id, scope);
  await KINDS[kind].delegate().update({ where: { id }, data: { isImportant } });
  await mirrorStagedDocument(kind, id);
  revalidate(await ownerPaths(kind, doc.ownerId));
}

// The row-and-file part of a permanent delete, with no module gate and no
// revalidation. Only for Trash retention (src/lib/trash.ts), which runs from
// a page render and from the scheduler, and purges whether or not the
// module is on. The row goes first, then the file (see documentStore.ts's
// reconciliation note for why that order).
export async function purgeDocument(kind: OwnedDocumentKind, id: string) {
  const doc = await requireDocument(kind, id);
  await KINDS[kind].delegate().delete({ where: { id } });
  await documentStoreFor(kind).remove(doc.ownerId, doc.storedName);
  if (kind === "PRODUCT" || kind === "INVENTORY_ITEM") {
    try { await removeStagedLegacyDocument(kind, id); }
    catch (error) { console.error("[items] couldn't remove staged %s Document %s", kind, id, error); }
  }
  return { ownerId: doc.ownerId };
}

/**
 * Removes every file of one owner record's Documents from disk. For record
 * commands permanently deleting the owner: the row delete cascades to the
 * Document rows, and this takes the files with them.
 */
export async function removeOwnerDocumentFiles(kind: OwnedDocumentKind, ownerId: string) {
  await documentStoreFor(kind).removeAll(ownerId);
}
