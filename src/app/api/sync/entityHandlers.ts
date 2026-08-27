import type { ZodTypeAny } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { ModuleKey } from "@/lib/modules/registry";
import { contractSchema } from "@/lib/validation/contract";
import { productSchema } from "@/lib/validation/product";
import { vehicleSchema, vehicleItemSchema } from "@/lib/validation/vehicles";
import { tripSchema, tripSegmentSchema } from "@/lib/validation/travel";
import {
  propertySchema,
  homeItemSchema,
  rentalAgreementSchema,
  rentalStatementSchema,
} from "@/lib/validation/home";
import { inventoryItemSchema } from "@/lib/validation/inventory";
import {
  portfolioSchema,
  holdingSchema,
  tradeSchema,
  propertyValuationSchema,
} from "@/lib/validation/wealth";
import { fetchHistoricalPrice } from "@/lib/prices";
import { createContractCommand, updateContractCommand, deleteContractCommand } from "@/lib/commands/contracts";
import { createProductCommand, updateProductCommand, deleteProductCommand } from "@/lib/commands/products";
import { extractSearchableText } from "@/lib/documents/textExtraction";
import { ProductDocumentKind } from "@/generated/prisma/enums";
import {
  MAX_UPLOAD_BYTES,
  saveDocument,
  saveProductDocument,
  saveHomeItemDocument,
  saveTripSegmentDocument,
  saveVehicleItemDocument,
  saveInventoryItemDocument,
  saveTradeDocument,
  saveRentalStatementDocument,
  deleteDocument as deleteContractDocument,
  deleteProductDocument,
  deleteHomeItemDocument,
  deleteRentalStatementDocument,
  deleteTripSegmentDocument,
  deleteVehicleItemDocument,
  deleteInventoryItemDocument,
  deleteTradeDocument,
  deleteTradeDir,
} from "@/lib/storage";

export interface SyncContext {
  userId: string;
  parentId?: string;
  baseUpdatedAt?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface EntitySyncConfig<T = any> {
  // Omitted for delete-only entities (the 8 document* entities below) — the
  // sync route never validates formValues for a "delete" op, so no schema
  // is needed there.
  schema?: ZodTypeAny;
  requiresModule?: ModuleKey;
  // Omitted for delete-only entities — an offline "create" for one of those
  // is rejected as unsupported (there's no such flow: documents are only
  // ever attached as part of their parent record's own create/update).
  create?: (data: T, ctx: SyncContext) => Promise<{ id: string }>;
  // Entities with no online "edit" flow (e.g. PropertyValuation, and every
  // document* entity) omit update — an offline "update" op for them is
  // rejected as unsupported.
  update?: (id: string, data: T, ctx: SyncContext) => Promise<void>;
  // `id` is the record's own id (a document's id for document* entities);
  // ctx.parentId carries the owning record's id where the live action needs
  // it for the ownership/scoping check (e.g. a document's contractId).
  remove?: (id: string, ctx: SyncContext) => Promise<void>;
  // Only present for entities whose create/update form can carry a file —
  // reuses the same storage.ts save*Document function the live server
  // action calls, so the on-disk path is identical.
  saveFile?: (entityId: string, file: File, fieldName: string) => Promise<void>;
}

function defineEntity<T>(config: EntitySyncConfig<T>): EntitySyncConfig<T> {
  return config;
}

function requireParentId(ctx: SyncContext): string {
  if (!ctx.parentId) throw new Error("Missing parent record");
  return ctx.parentId;
}

function validateFile(file: File) {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("File is too large (15MB max).");
}

// Detects (doesn't merge) a conflicting edit: if the record's updatedAt has
// moved on from what the client had loaded when it made this offline edit,
// don't silently overwrite — surface it as a sync failure instead. Skipped
// when the client didn't send a baseUpdatedAt (e.g. RentalAgreement, which
// has no updatedAt column) or online writes made before this feature shipped.
function assertNotStale(existing: { updatedAt: Date }, ctx: SyncContext) {
  if (!ctx.baseUpdatedAt) return;
  if (existing.updatedAt.toISOString() !== ctx.baseUpdatedAt) {
    throw new Error("This record was changed elsewhere since you edited it — review before retrying.");
  }
}

export const ENTITY_SYNC_CONFIGS: Record<string, EntitySyncConfig> = {
  // ── Contracts (always-on, household-wide) ─────────────────────────────────
  contract: defineEntity({
    schema: contractSchema,
    create: async (data, { userId }) => {
      const contract = await createContractCommand(data, userId);
      return { id: contract.id };
    },
    update: async (id, data, ctx) => {
      const existing = await prisma.contract.findUnique({ where: { id } });
      if (!existing) throw new Error("Contract not found");
      assertNotStale(existing, ctx);
      await updateContractCommand(id, data, ctx.userId);
    },
    // #287 — soft-delete, matching deleteContract in actions/contracts.ts:
    // moves to Trash instead of removing the row and files outright.
    remove: async (id) => {
      await deleteContractCommand(id);
    },
    saveFile: async (contractId, file) => {
      validateFile(file);
      const { storedName, size, sha256, mimeType } = await saveDocument(contractId, file);
      const extractedText = await extractSearchableText(Buffer.from(await file.arrayBuffer()), mimeType);
      await prisma.document.create({
        data: { contractId, filename: file.name.slice(0, 255), storedName, mimeType, size, extractedText, sha256 },
      });
    },
  }),

  // ── Products (always-on, household-wide) ──────────────────────────────────
  product: defineEntity({
    schema: productSchema,
    create: async (data, { userId }) => {
      const product = await createProductCommand(data, userId);
      return { id: product.id };
    },
    update: async (id, data, ctx) => {
      const existing = await prisma.product.findUnique({ where: { id } });
      if (!existing) throw new Error("Product not found");
      assertNotStale(existing, ctx);
      await updateProductCommand(id, data, ctx.userId);
    },
    // #287 — soft-delete, matching deleteProduct in actions/products.ts.
    remove: async (id) => {
      await deleteProductCommand(id);
    },
    // Products carry two independent file fields (invoiceFile / photoFile);
    // only invoices are OCR'd for search, matching attachProductDocument().
    saveFile: async (productId, file, fieldName) => {
      validateFile(file);
      const kind = fieldName === "photoFile" ? ProductDocumentKind.PHOTO : ProductDocumentKind.INVOICE;
      const { storedName, size, sha256, mimeType } = await saveProductDocument(productId, file);
      const extractedText =
        kind === ProductDocumentKind.INVOICE
          ? await extractSearchableText(Buffer.from(await file.arrayBuffer()), mimeType)
          : null;
      await prisma.productDocument.create({
        data: { productId, filename: file.name.slice(0, 255), storedName, mimeType, size, kind, extractedText, sha256 },
      });
    },
  }),

  // ── Vehicles (household-shared — no ownership check, matches the live action) ─
  vehicle: defineEntity({
    schema: vehicleSchema,
    requiresModule: "VEHICLES",
    create: async (data, { userId }) => {
      const vehicle = await prisma.vehicle.create({ data: { ...data, createdById: userId } });
      revalidatePath("/vehicles");
      return { id: vehicle.id };
    },
    update: async (id, data, ctx) => {
      const existing = await prisma.vehicle.findUnique({ where: { id } });
      if (!existing) throw new Error("Vehicle not found");
      assertNotStale(existing, ctx);
      await prisma.vehicle.update({ where: { id }, data });
      revalidatePath("/vehicles");
      revalidatePath(`/vehicles/${id}`);
    },
    // #287 — soft-delete, matching deleteVehicle in actions/vehicles.ts.
    remove: async (id) => {
      const existing = await prisma.vehicle.findUnique({ where: { id } });
      if (!existing) throw new Error("Vehicle not found");
      await prisma.vehicle.update({ where: { id }, data: { deletedAt: new Date() } });
      revalidatePath("/vehicles");
      revalidatePath("/settings/trash");
    },
  }),

  vehicleItem: defineEntity({
    schema: vehicleItemSchema,
    requiresModule: "VEHICLES",
    create: async (data, ctx) => {
      const vehicleId = requireParentId(ctx);
      const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
      if (!vehicle) throw new Error("Vehicle not found");
      const item = await prisma.vehicleItem.create({ data: { ...data, vehicleId } });
      revalidatePath(`/vehicles/${vehicleId}`);
      return { id: item.id };
    },
    update: async (id, data, ctx) => {
      const vehicleId = requireParentId(ctx);
      const existing = await prisma.vehicleItem.findUnique({ where: { id } });
      if (!existing || existing.vehicleId !== vehicleId) throw new Error("Item not found");
      assertNotStale(existing, ctx);
      await prisma.vehicleItem.update({ where: { id }, data });
      revalidatePath(`/vehicles/${vehicleId}`);
    },
    saveFile: async (vehicleItemId, file) => {
      validateFile(file);
      const { storedName, size, sha256, mimeType } = await saveVehicleItemDocument(vehicleItemId, file);
      await prisma.vehicleItemDocument.create({
        data: { vehicleItemId, filename: file.name.slice(0, 255), storedName, mimeType, size, sha256 },
      });
    },
  }),

  // ── Travel (household-shared) ──────────────────────────────────────────────
  trip: defineEntity({
    schema: tripSchema,
    requiresModule: "TRAVEL",
    create: async (data, { userId }) => {
      const trip = await prisma.trip.create({ data: { ...data, createdById: userId } });
      revalidatePath("/travel");
      return { id: trip.id };
    },
    update: async (id, data, ctx) => {
      const existing = await prisma.trip.findUnique({ where: { id } });
      if (!existing) throw new Error("Trip not found");
      assertNotStale(existing, ctx);
      await prisma.trip.update({ where: { id }, data });
      revalidatePath("/travel");
      revalidatePath(`/travel/${id}`);
    },
    // #287 — soft-delete, matching deleteTrip in actions/trips.ts.
    remove: async (id) => {
      const existing = await prisma.trip.findUnique({ where: { id } });
      if (!existing) throw new Error("Trip not found");
      await prisma.trip.update({ where: { id }, data: { deletedAt: new Date() } });
      revalidatePath("/travel");
      revalidatePath("/settings/trash");
    },
  }),

  tripSegment: defineEntity({
    schema: tripSegmentSchema,
    requiresModule: "TRAVEL",
    create: async (data, ctx) => {
      const tripId = requireParentId(ctx);
      const trip = await prisma.trip.findUnique({ where: { id: tripId } });
      if (!trip) throw new Error("Trip not found");
      const segment = await prisma.tripSegment.create({ data: { ...data, tripId } });
      revalidatePath(`/travel/${tripId}`);
      return { id: segment.id };
    },
    update: async (id, data, ctx) => {
      const tripId = requireParentId(ctx);
      const existing = await prisma.tripSegment.findUnique({ where: { id } });
      if (!existing || existing.tripId !== tripId) throw new Error("Segment not found");
      assertNotStale(existing, ctx);
      await prisma.tripSegment.update({ where: { id }, data });
      revalidatePath(`/travel/${tripId}`);
    },
    saveFile: async (segmentId, file) => {
      validateFile(file);
      const { storedName, size, sha256, mimeType } = await saveTripSegmentDocument(segmentId, file);
      await prisma.tripSegmentDocument.create({
        data: { tripSegmentId: segmentId, filename: file.name.slice(0, 255), storedName, mimeType, size, sha256 },
      });
    },
  }),

  // ── Home (household-shared) ────────────────────────────────────────────────
  property: defineEntity({
    schema: propertySchema,
    requiresModule: "HOME",
    create: async (data, { userId }) => {
      const property = await prisma.property.create({ data: { ...data, createdById: userId } });
      revalidatePath("/home");
      return { id: property.id };
    },
    update: async (id, data, ctx) => {
      const existing = await prisma.property.findUnique({ where: { id } });
      if (!existing) throw new Error("Property not found");
      assertNotStale(existing, ctx);
      await prisma.property.update({ where: { id }, data });
      revalidatePath("/home");
      revalidatePath(`/home/${id}`);
    },
    // #287 — soft-delete, matching deleteProperty in actions/home.ts.
    remove: async (id) => {
      const existing = await prisma.property.findUnique({ where: { id } });
      if (!existing) throw new Error("Property not found");
      await prisma.property.update({ where: { id }, data: { deletedAt: new Date() } });
      revalidatePath("/home");
      revalidatePath("/settings/trash");
    },
  }),

  homeItem: defineEntity({
    schema: homeItemSchema,
    requiresModule: "HOME",
    create: async (data, ctx) => {
      const propertyId = requireParentId(ctx);
      const property = await prisma.property.findUnique({ where: { id: propertyId } });
      if (!property) throw new Error("Property not found");
      const item = await prisma.homeItem.create({ data: { ...data, propertyId } });
      revalidatePath(`/home/${propertyId}`);
      return { id: item.id };
    },
    update: async (id, data, ctx) => {
      const propertyId = requireParentId(ctx);
      const existing = await prisma.homeItem.findUnique({ where: { id } });
      if (!existing || existing.propertyId !== propertyId) throw new Error("Item not found");
      assertNotStale(existing, ctx);
      await prisma.homeItem.update({ where: { id }, data });
      revalidatePath(`/home/${propertyId}`);
    },
    saveFile: async (homeItemId, file) => {
      validateFile(file);
      const { storedName, size, sha256, mimeType } = await saveHomeItemDocument(homeItemId, file);
      await prisma.homeItemDocument.create({
        data: { homeItemId, filename: file.name.slice(0, 255), storedName, mimeType, size, sha256 },
      });
    },
  }),

  // Note: RentalAgreement has no `updatedAt` field in the schema (unlike every
  // other model here) — it's exempt from the Phase 6 conflict check.
  rentalAgreement: defineEntity({
    schema: rentalAgreementSchema,
    requiresModule: "HOME",
    create: async (data, ctx) => {
      const propertyId = requireParentId(ctx);
      const property = await prisma.property.findUnique({ where: { id: propertyId } });
      if (!property) throw new Error("Property not found");
      const [agreement] = await prisma.$transaction([
        prisma.rentalAgreement.create({ data: { ...data, propertyId } }),
        prisma.property.update({ where: { id: propertyId }, data: { isRented: true } }),
      ]);
      revalidatePath(`/home/${propertyId}`);
      revalidatePath(`/home/${propertyId}/rental`);
      return { id: agreement.id };
    },
    update: async (id, data, ctx) => {
      const propertyId = requireParentId(ctx);
      const existing = await prisma.rentalAgreement.findUnique({ where: { id } });
      if (!existing || existing.propertyId !== propertyId) throw new Error("Agreement not found");
      await prisma.rentalAgreement.update({ where: { id }, data });
      revalidatePath(`/home/${propertyId}`);
      revalidatePath(`/home/${propertyId}/rental`);
    },
  }),

  rentalStatement: defineEntity({
    schema: rentalStatementSchema,
    requiresModule: "HOME",
    create: async (data, ctx) => {
      const propertyId = requireParentId(ctx);
      const property = await prisma.property.findUnique({ where: { id: propertyId } });
      if (!property) throw new Error("Property not found");
      const statement = await prisma.rentalStatement.create({ data: { ...data, propertyId } });
      revalidatePath(`/home/${propertyId}/rental`);
      return { id: statement.id };
    },
    update: async (id, data, ctx) => {
      const propertyId = requireParentId(ctx);
      const existing = await prisma.rentalStatement.findUnique({ where: { id } });
      if (!existing || existing.propertyId !== propertyId) throw new Error("Statement not found");
      assertNotStale(existing, ctx);
      await prisma.rentalStatement.update({ where: { id }, data });
      revalidatePath(`/home/${propertyId}/rental`);
    },
    saveFile: async (statementId, file) => {
      validateFile(file);
      const { storedName, size, sha256, mimeType } = await saveRentalStatementDocument(statementId, file);
      await prisma.rentalStatementDocument.create({
        data: { rentalStatementId: statementId, filename: file.name.slice(0, 255), storedName, mimeType, size, sha256 },
      });
    },
  }),

  // ── Inventory (per-user ownership) ─────────────────────────────────────────
  inventoryItem: defineEntity({
    schema: inventoryItemSchema,
    requiresModule: "INVENTORY",
    create: async (data, { userId }) => {
      const item = await prisma.inventoryItem.create({ data: { ...data, createdById: userId } });
      revalidatePath("/inventory");
      return { id: item.id };
    },
    update: async (id, data, ctx) => {
      const existing = await prisma.inventoryItem.findUnique({ where: { id } });
      if (!existing) throw new Error("Item not found");
      assertNotStale(existing, ctx);
      await prisma.inventoryItem.update({ where: { id }, data });
      revalidatePath("/inventory");
      revalidatePath(`/inventory/${id}`);
    },
    // #287 — soft-delete, matching deleteInventoryItem in actions/inventory.ts.
    remove: async (id) => {
      const existing = await prisma.inventoryItem.findUnique({ where: { id } });
      if (!existing) throw new Error("Item not found");
      await prisma.inventoryItem.update({ where: { id }, data: { deletedAt: new Date() } });
      revalidatePath("/inventory");
      revalidatePath("/settings/trash");
    },
    saveFile: async (itemId, file) => {
      validateFile(file);
      const { storedName, size, sha256, mimeType } = await saveInventoryItemDocument(itemId, file);
      await prisma.inventoryItemDocument.create({
        data: { inventoryItemId: itemId, filename: file.name.slice(0, 255), storedName, mimeType, size, sha256 },
      });
    },
  }),

  // ── Wealth (household-wide, like every other module) ──────────────────────
  portfolio: defineEntity({
    schema: portfolioSchema,
    requiresModule: "WEALTH",
    create: async (data, { userId }) => {
      const portfolio = await prisma.portfolio.create({ data: { ...data, createdById: userId } });
      revalidatePath("/wealth");
      return { id: portfolio.id };
    },
    update: async (id, data, ctx) => {
      const existing = await prisma.portfolio.findUnique({ where: { id } });
      if (!existing) throw new Error("Portfolio not found");
      assertNotStale(existing, ctx);
      await prisma.portfolio.update({ where: { id }, data });
      revalidatePath("/wealth");
      revalidatePath(`/wealth/portfolios/${id}`);
    },
    remove: async (id) => {
      const existing = await prisma.portfolio.findUnique({
        where: { id },
        include: { holdings: { include: { trades: { select: { id: true } } } } },
      });
      if (!existing) throw new Error("Portfolio not found");
      // Cascade removes the DB rows but not the uploaded trade-document
      // files — clean those up first, same as the online deletePortfolio action.
      for (const holding of existing.holdings) {
        for (const trade of holding.trades) {
          await deleteTradeDir(trade.id);
        }
      }
      await prisma.portfolio.delete({ where: { id } });
      revalidatePath("/wealth");
    },
  }),

  holding: defineEntity({
    schema: holdingSchema,
    requiresModule: "WEALTH",
    create: async (data, ctx) => {
      const portfolioId = requireParentId(ctx);
      const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
      if (!portfolio) throw new Error("Portfolio not found");
      const existing = await prisma.holding.findUnique({
        where: { portfolioId_ticker: { portfolioId, ticker: data.ticker } },
      });
      if (existing) throw new Error(`${data.ticker} is already in this portfolio.`);
      const holding = await prisma.holding.create({ data: { ...data, portfolioId } });
      revalidatePath(`/wealth/portfolios/${portfolioId}`);
      return { id: holding.id };
    },
    update: async (id, data, ctx) => {
      const holding = await prisma.holding.findUnique({
        where: { id },
        include: { portfolio: true },
      });
      if (!holding) throw new Error("Holding not found");
      assertNotStale(holding, ctx);
      await prisma.holding.update({ where: { id }, data });
      revalidatePath(`/wealth/portfolios/${holding.portfolioId}/holdings/${id}`);
    },
  }),

  trade: defineEntity({
    schema: tradeSchema,
    requiresModule: "WEALTH",
    create: async (data, ctx) => {
      const holdingId = requireParentId(ctx);
      const holding = await prisma.holding.findUnique({
        where: { id: holdingId },
        include: { portfolio: true },
      });
      if (!holding) throw new Error("Holding not found");
      const trade = await prisma.trade.create({ data: { ...data, holdingId } });
      if (holding.exchange !== "CRYPTO") {
        fetchHistoricalPrice(holding.ticker, data.date)
          .then((marketPrice) => {
            if (marketPrice != null) {
              return prisma.trade.update({ where: { id: trade.id }, data: { marketPriceOnDate: marketPrice } });
            }
          })
          .catch(() => {});
      }
      revalidatePath(`/wealth/portfolios/${holding.portfolioId}/holdings/${holdingId}`);
      return { id: trade.id };
    },
    update: async (id, data, ctx) => {
      const holdingId = requireParentId(ctx);
      const holding = await prisma.holding.findUnique({
        where: { id: holdingId },
        include: { portfolio: true },
      });
      if (!holding) throw new Error("Holding not found");
      const trade = await prisma.trade.findUnique({ where: { id } });
      if (!trade || trade.holdingId !== holdingId) throw new Error("Trade not found");
      assertNotStale(trade, ctx);
      await prisma.trade.update({ where: { id }, data });
      revalidatePath(`/wealth/portfolios/${holding.portfolioId}/holdings/${holdingId}`);
    },
    saveFile: async (tradeId, file) => {
      validateFile(file);
      const { storedName, size, sha256, mimeType } = await saveTradeDocument(tradeId, file);
      await prisma.tradeDocument.create({
        data: { tradeId, filename: file.name.slice(0, 255), storedName, mimeType, size, sha256 },
      });
    },
  }),

  // No update action exists for PropertyValuation in the live app (create + delete
  // only) — offline queue never produces an "update" for it, so `update` is omitted.
  propertyValuation: defineEntity({
    schema: propertyValuationSchema,
    // Matches the live action (requireHomeEnabled): no module gate here, only auth.
    create: async (data, ctx) => {
      const propertyId = requireParentId(ctx);
      const property = await prisma.property.findUnique({ where: { id: propertyId } });
      if (!property) throw new Error("Property not found");
      const valuation = await prisma.propertyValuation.create({ data: { ...data, propertyId } });
      revalidatePath(`/home/${propertyId}`);
      return { id: valuation.id };
    },
  }),

  // ── Document deletes (remove-only — a document you can delete is always
  // already-synced, since it's rendered from server data, so there's no
  // pending-record problem like offline-created entities have) ─────────────
  contractDocument: defineEntity({
    remove: async (documentId, ctx) => {
      const contractId = requireParentId(ctx);
      const doc = await prisma.document.findUnique({ where: { id: documentId } });
      if (!doc || doc.contractId !== contractId) throw new Error("Document not found");
      await prisma.document.delete({ where: { id: documentId } });
      await deleteContractDocument(contractId, doc.storedName);
      revalidatePath(`/contracts/${contractId}`);
    },
  }),

  productDocument: defineEntity({
    remove: async (documentId, ctx) => {
      const productId = requireParentId(ctx);
      const doc = await prisma.productDocument.findUnique({ where: { id: documentId } });
      if (!doc || doc.productId !== productId) throw new Error("Document not found");
      await prisma.productDocument.delete({ where: { id: documentId } });
      await deleteProductDocument(productId, doc.storedName);
      revalidatePath(`/products/${productId}`);
    },
  }),

  homeItemDocument: defineEntity({
    remove: async (documentId, ctx) => {
      const homeItemId = requireParentId(ctx);
      const doc = await prisma.homeItemDocument.findUnique({ where: { id: documentId } });
      if (!doc || doc.homeItemId !== homeItemId) throw new Error("Document not found");
      const item = await prisma.homeItem.findUnique({ where: { id: homeItemId } });
      await prisma.homeItemDocument.delete({ where: { id: documentId } });
      await deleteHomeItemDocument(homeItemId, doc.storedName);
      if (item) revalidatePath(`/home/${item.propertyId}`);
    },
  }),

  rentalStatementDocument: defineEntity({
    remove: async (documentId, ctx) => {
      const statementId = requireParentId(ctx);
      const doc = await prisma.rentalStatementDocument.findUnique({ where: { id: documentId } });
      if (!doc || doc.rentalStatementId !== statementId) throw new Error("Document not found");
      const statement = await prisma.rentalStatement.findUnique({ where: { id: statementId } });
      await prisma.rentalStatementDocument.delete({ where: { id: documentId } });
      await deleteRentalStatementDocument(statementId, doc.storedName);
      if (statement) revalidatePath(`/home/${statement.propertyId}/rental`);
    },
  }),

  tripSegmentDocument: defineEntity({
    remove: async (documentId, ctx) => {
      const segmentId = requireParentId(ctx);
      const doc = await prisma.tripSegmentDocument.findUnique({ where: { id: documentId } });
      if (!doc || doc.tripSegmentId !== segmentId) throw new Error("Document not found");
      const segment = await prisma.tripSegment.findUnique({ where: { id: segmentId } });
      await prisma.tripSegmentDocument.delete({ where: { id: documentId } });
      await deleteTripSegmentDocument(segmentId, doc.storedName);
      if (segment) revalidatePath(`/travel/${segment.tripId}`);
    },
  }),

  vehicleItemDocument: defineEntity({
    remove: async (documentId, ctx) => {
      const vehicleItemId = requireParentId(ctx);
      const doc = await prisma.vehicleItemDocument.findUnique({ where: { id: documentId } });
      if (!doc || doc.vehicleItemId !== vehicleItemId) throw new Error("Document not found");
      const item = await prisma.vehicleItem.findUnique({ where: { id: vehicleItemId } });
      await prisma.vehicleItemDocument.delete({ where: { id: documentId } });
      await deleteVehicleItemDocument(vehicleItemId, doc.storedName);
      if (item) revalidatePath(`/vehicles/${item.vehicleId}`);
    },
  }),

  inventoryItemDocument: defineEntity({
    remove: async (documentId, ctx) => {
      const itemId = requireParentId(ctx);
      const doc = await prisma.inventoryItemDocument.findUnique({ where: { id: documentId } });
      if (!doc || doc.inventoryItemId !== itemId) throw new Error("Document not found");
      const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
      if (!item) throw new Error("Item not found");
      await prisma.inventoryItemDocument.delete({ where: { id: documentId } });
      await deleteInventoryItemDocument(itemId, doc.storedName);
      revalidatePath(`/inventory/${itemId}`);
    },
  }),

  // ctx.parentId is the holdingId — the document's own tradeId (once fetched)
  // is sufficient to resolve which trade/holding/portfolio it belongs to, so
  // unlike the live action this doesn't need a separate tradeId param.
  tradeDocument: defineEntity({
    remove: async (documentId, ctx) => {
      const holdingId = requireParentId(ctx);
      const doc = await prisma.tradeDocument.findUnique({ where: { id: documentId } });
      if (!doc) throw new Error("Document not found");
      const holding = await prisma.holding.findUnique({
        where: { id: holdingId },
        include: { portfolio: true },
      });
      if (!holding) throw new Error("Holding not found");
      const trade = await prisma.trade.findUnique({ where: { id: doc.tradeId } });
      if (!trade || trade.holdingId !== holdingId) throw new Error("Document not found");
      await prisma.tradeDocument.delete({ where: { id: documentId } });
      await deleteTradeDocument(doc.tradeId, doc.storedName);
      revalidatePath(`/wealth/portfolios/${holding.portfolioId}/holdings/${holdingId}`);
    },
  }),
};
