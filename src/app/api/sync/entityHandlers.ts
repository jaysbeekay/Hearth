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
import { extractSearchableText } from "@/lib/documents/textExtraction";
import { ProductDocumentKind } from "@/generated/prisma/enums";
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  saveDocument,
  saveProductDocument,
  saveHomeItemDocument,
  saveTripSegmentDocument,
  saveVehicleItemDocument,
  saveInventoryItemDocument,
  saveTradeDocument,
  saveRentalStatementDocument,
  deleteContractDir,
  deleteProductDir,
  deleteTripSegmentDir,
  deleteHomeItemDir,
  deleteInventoryItemDir,
  deleteVehicleItemDir,
} from "@/lib/storage";

export interface SyncContext {
  userId: string;
  parentId?: string;
  baseUpdatedAt?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface EntitySyncConfig<T = any> {
  schema: ZodTypeAny;
  requiresModule?: ModuleKey;
  create: (data: T, ctx: SyncContext) => Promise<{ id: string }>;
  // Entities with no online "edit" flow (e.g. PropertyValuation) omit update —
  // an offline "update" op for them is rejected as unsupported.
  update?: (id: string, data: T, ctx: SyncContext) => Promise<void>;
  // Only wired up for top-level entities with a ConfirmForm `offline` prop
  // (see ConfirmForm.tsx) — child-record and document deletes are deferred.
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
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error("Unsupported file type. Use PDF, Word, or image files.");
  }
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
  // ── Contracts (always-on, per-user ownership) ──────────────────────────────
  contract: defineEntity({
    schema: contractSchema,
    create: async (data, { userId }) => {
      const contract = await prisma.contract.create({ data: { ...data, createdById: userId } });
      revalidatePath("/contracts");
      return { id: contract.id };
    },
    update: async (id, data, ctx) => {
      const existing = await prisma.contract.findUnique({ where: { id } });
      if (!existing || existing.createdById !== ctx.userId) throw new Error("Contract not found");
      assertNotStale(existing, ctx);
      await prisma.contract.update({ where: { id }, data });
      revalidatePath("/contracts");
      revalidatePath(`/contracts/${id}`);
    },
    remove: async (id) => {
      const existing = await prisma.contract.findUnique({ where: { id } });
      if (!existing) throw new Error("Contract not found");
      await prisma.contract.delete({ where: { id } });
      await deleteContractDir(id);
      revalidatePath("/contracts");
      revalidatePath("/dashboard");
    },
    saveFile: async (contractId, file) => {
      validateFile(file);
      const { storedName, size } = await saveDocument(contractId, file);
      const extractedText = await extractSearchableText(Buffer.from(await file.arrayBuffer()), file.type);
      await prisma.document.create({
        data: { contractId, filename: file.name.slice(0, 255), storedName, mimeType: file.type, size, extractedText },
      });
    },
  }),

  // ── Products (always-on, per-user ownership) ───────────────────────────────
  product: defineEntity({
    schema: productSchema,
    create: async (data, { userId }) => {
      const product = await prisma.product.create({ data: { ...data, createdById: userId } });
      revalidatePath("/products");
      return { id: product.id };
    },
    update: async (id, data, ctx) => {
      const existing = await prisma.product.findUnique({ where: { id } });
      if (!existing || existing.createdById !== ctx.userId) throw new Error("Product not found");
      assertNotStale(existing, ctx);
      await prisma.product.update({ where: { id }, data });
      revalidatePath("/products");
      revalidatePath(`/products/${id}`);
    },
    remove: async (id) => {
      const existing = await prisma.product.findUnique({ where: { id } });
      if (!existing) throw new Error("Product not found");
      await prisma.product.delete({ where: { id } });
      await deleteProductDir(id);
      revalidatePath("/products");
      revalidatePath("/dashboard");
    },
    // Products carry two independent file fields (invoiceFile / photoFile);
    // only invoices are OCR'd for search, matching attachProductDocument().
    saveFile: async (productId, file, fieldName) => {
      validateFile(file);
      const kind = fieldName === "photoFile" ? ProductDocumentKind.PHOTO : ProductDocumentKind.INVOICE;
      const { storedName, size } = await saveProductDocument(productId, file);
      const extractedText =
        kind === ProductDocumentKind.INVOICE
          ? await extractSearchableText(Buffer.from(await file.arrayBuffer()), file.type)
          : null;
      await prisma.productDocument.create({
        data: { productId, filename: file.name.slice(0, 255), storedName, mimeType: file.type, size, kind, extractedText },
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
    remove: async (id) => {
      const existing = await prisma.vehicle.findUnique({
        where: { id },
        include: { items: { select: { id: true } } },
      });
      if (!existing) throw new Error("Vehicle not found");
      for (const item of existing.items) {
        await deleteVehicleItemDir(item.id);
      }
      await prisma.vehicle.delete({ where: { id } });
      revalidatePath("/vehicles");
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
      const { storedName, size } = await saveVehicleItemDocument(vehicleItemId, file);
      await prisma.vehicleItemDocument.create({
        data: { vehicleItemId, filename: file.name.slice(0, 255), storedName, mimeType: file.type, size },
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
    remove: async (id) => {
      const existing = await prisma.trip.findUnique({
        where: { id },
        include: { segments: { select: { id: true } } },
      });
      if (!existing) throw new Error("Trip not found");
      for (const segment of existing.segments) {
        await deleteTripSegmentDir(segment.id);
      }
      await prisma.trip.delete({ where: { id } });
      revalidatePath("/travel");
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
      const { storedName, size } = await saveTripSegmentDocument(segmentId, file);
      await prisma.tripSegmentDocument.create({
        data: { tripSegmentId: segmentId, filename: file.name.slice(0, 255), storedName, mimeType: file.type, size },
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
    remove: async (id) => {
      const existing = await prisma.property.findUnique({
        where: { id },
        include: { items: { select: { id: true } } },
      });
      if (!existing) throw new Error("Property not found");
      for (const item of existing.items) {
        await deleteHomeItemDir(item.id);
      }
      await prisma.property.delete({ where: { id } });
      revalidatePath("/home");
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
      const { storedName, size } = await saveHomeItemDocument(homeItemId, file);
      await prisma.homeItemDocument.create({
        data: { homeItemId, filename: file.name.slice(0, 255), storedName, mimeType: file.type, size },
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
      const { storedName, size } = await saveRentalStatementDocument(statementId, file);
      await prisma.rentalStatementDocument.create({
        data: { rentalStatementId: statementId, filename: file.name.slice(0, 255), storedName, mimeType: file.type, size },
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
      if (!existing || existing.createdById !== ctx.userId) throw new Error("Item not found");
      assertNotStale(existing, ctx);
      await prisma.inventoryItem.update({ where: { id }, data });
      revalidatePath("/inventory");
      revalidatePath(`/inventory/${id}`);
    },
    remove: async (id, { userId }) => {
      const existing = await prisma.inventoryItem.findUnique({ where: { id } });
      if (!existing || existing.createdById !== userId) throw new Error("Item not found");
      await deleteInventoryItemDir(id);
      await prisma.inventoryItem.delete({ where: { id } });
      revalidatePath("/inventory");
    },
    saveFile: async (itemId, file) => {
      validateFile(file);
      const { storedName, size } = await saveInventoryItemDocument(itemId, file);
      await prisma.inventoryItemDocument.create({
        data: { inventoryItemId: itemId, filename: file.name.slice(0, 255), storedName, mimeType: file.type, size },
      });
    },
  }),

  // ── Wealth (per-user ownership via portfolio.createdById) ──────────────────
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
      if (!existing || existing.createdById !== ctx.userId) throw new Error("Portfolio not found");
      assertNotStale(existing, ctx);
      await prisma.portfolio.update({ where: { id }, data });
      revalidatePath("/wealth");
      revalidatePath(`/wealth/portfolios/${id}`);
    },
    remove: async (id, { userId }) => {
      const existing = await prisma.portfolio.findUnique({ where: { id } });
      if (!existing || existing.createdById !== userId) throw new Error("Portfolio not found");
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
      if (!portfolio || portfolio.createdById !== ctx.userId) throw new Error("Portfolio not found");
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
      if (!holding || holding.portfolio.createdById !== ctx.userId) throw new Error("Holding not found");
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
      if (!holding || holding.portfolio.createdById !== ctx.userId) throw new Error("Holding not found");
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
      if (!holding || holding.portfolio.createdById !== ctx.userId) throw new Error("Holding not found");
      const trade = await prisma.trade.findUnique({ where: { id } });
      if (!trade || trade.holdingId !== holdingId) throw new Error("Trade not found");
      assertNotStale(trade, ctx);
      await prisma.trade.update({ where: { id }, data });
      revalidatePath(`/wealth/portfolios/${holding.portfolioId}/holdings/${holdingId}`);
    },
    saveFile: async (tradeId, file) => {
      validateFile(file);
      const { storedName, size } = await saveTradeDocument(tradeId, file);
      await prisma.tradeDocument.create({
        data: { tradeId, filename: file.name.slice(0, 255), storedName, mimeType: file.type, size },
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
      if (!property || property.createdById !== ctx.userId) throw new Error("Property not found");
      const valuation = await prisma.propertyValuation.create({ data: { ...data, propertyId } });
      revalidatePath(`/home/${propertyId}`);
      return { id: valuation.id };
    },
  }),
};
