import type { ZodObject } from "zod";
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
import {
  createVehicleCommand,
  updateVehicleCommand,
  deleteVehicleCommand,
  createServiceRecordCommand,
  updateServiceRecordCommand,
} from "@/lib/commands/vehicles";
import {
  createTripCommand,
  updateTripCommand,
  deleteTripCommand,
  createTripSegmentCommand,
  updateTripSegmentCommand,
} from "@/lib/commands/trips";
import { updateUnlessStale } from "@/lib/commands/shared";
import { fullFormUpdate } from "@/lib/validation/fullFormUpdate";
import {
  formToContractInput,
  formToProductInput,
  formToVehicleInput,
  formToVehicleItemInput,
  formToTripInput,
  formToTripSegmentInput,
  formToPropertyInput,
  formToHomeItemInput,
  formToRentalAgreementInput,
  formToRentalStatementInput,
  formToInventoryItemInput,
  formToPortfolioInput,
  formToHoldingInput,
  formToTradeInput,
  formToPropertyValuationInput,
} from "@/lib/formMappers";
import { ProductDocumentKind } from "@/generated/prisma/enums";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";
import {
  addDocumentCommand,
  deleteDocumentCommand,
  findDocument,
  findDocumentAnyKind,
  removeOwnerDocumentFiles,
} from "@/lib/commands/documents";
import { isOwnedDocumentKind, LEGACY_DOCUMENT_SYNC_ENTITIES } from "@/lib/documents/kinds";

export interface SyncContext {
  userId: string;
  parentId?: string;
  baseUpdatedAt?: string;
  // The `document` entity only: which Document kind entityId is (#396).
  kind?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface EntitySyncConfig<T = any> {
  // Omitted for delete-only entities (the `document` entity below) — the
  // sync route never validates formValues for a "delete" op, so no schema
  // is needed there.
  schema?: ZodObject;
  // The same FormData -> schema-input mapper the online server action uses
  // (src/lib/formMappers.ts), so a queued op gets the action's checkbox
  // handling ("on" -> true, absent -> false) and its fallbacks (currency
  // "AUD", assetClass "SHARE", ...) instead of parsing raw strings (#413).
  input?: (formData: FormData) => unknown;
  requiresModule?: ModuleKey;
  // Omitted for delete-only entities — an offline "create" for one of those
  // is rejected as unsupported (there's no such flow: documents are only
  // ever attached as part of their parent record's own create/update).
  create?: (data: T, ctx: SyncContext) => Promise<{ id: string }>;
  // Entities with no online "edit" flow (e.g. PropertyValuation, and the
  // document entity) omit update — an offline "update" op for them is
  // rejected as unsupported.
  update?: (id: string, data: T, ctx: SyncContext) => Promise<void>;
  // `id` is the record's own id (a document's id for the document entity);
  // ctx.parentId carries the owning record's id where the live action needs
  // it for the ownership/scoping check (e.g. a document's contractId).
  remove?: (id: string, ctx: SyncContext) => Promise<void>;
  // Only present for entities whose create/update form can carry a file —
  // goes through the same Document command the live server action uses.
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

function toFormData(values: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.append(key, value);
  return formData;
}

// Validates an offline create/update's formValues against the entity's
// schema. An update is the edit form's full submission, so every field it
// sent blank becomes `null` and clears, as in the online action (#413).
export function parseSyncFormValues(
  config: EntitySyncConfig,
  operation: "create" | "update",
  formValues: Record<string, string> = {},
) {
  if (!config.schema) throw new Error("This record type doesn't support this offline");
  const parsed = config.schema.safeParse(config.input ? config.input(toFormData(formValues)) : formValues);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid data");
  return operation === "update" ? fullFormUpdate(config.schema, parsed.data, formValues) : parsed.data;
}

export const ENTITY_SYNC_CONFIGS: Record<string, EntitySyncConfig> = {
  // ── Contracts (always-on, household-wide) ─────────────────────────────────
  contract: defineEntity({
    schema: contractSchema,
    input: formToContractInput,
    create: async (data, { userId }) => {
      const contract = await createContractCommand(data, userId);
      return { id: contract.id };
    },
    update: async (id, data, ctx) => {
      await updateContractCommand(id, data, ctx.userId, { baseUpdatedAt: ctx.baseUpdatedAt });
    },
    // #287 — soft-delete, matching deleteContract in actions/contracts.ts:
    // moves to Trash instead of removing the row and files outright.
    remove: async (id) => {
      await deleteContractCommand(id);
    },
    saveFile: async (contractId, file) => {
      validateFile(file);
      await addDocumentCommand("CONTRACT", contractId, { file });
    },
  }),

  // ── Products (always-on, household-wide) ──────────────────────────────────
  product: defineEntity({
    schema: productSchema,
    input: formToProductInput,
    create: async (data, { userId }) => {
      const product = await createProductCommand(data, userId);
      return { id: product.id };
    },
    update: async (id, data, ctx) => {
      await updateProductCommand(id, data, ctx.userId, { baseUpdatedAt: ctx.baseUpdatedAt });
    },
    // #287 — soft-delete, matching deleteProduct in actions/products.ts.
    remove: async (id) => {
      await deleteProductCommand(id);
    },
    // Products carry two independent file fields (invoiceFile / photoFile);
    // only invoices are OCR'd for search, as in the live createProduct.
    saveFile: async (productId, file, fieldName) => {
      validateFile(file);
      const isPhoto = fieldName === "photoFile";
      await addDocumentCommand("PRODUCT", productId, {
        file,
        productKind: isPhoto ? ProductDocumentKind.PHOTO : ProductDocumentKind.INVOICE,
        category: isPhoto ? "PHOTO" : "INVOICE",
      });
    },
  }),

  // ── Vehicles (household-shared — no ownership check, matches the live action) ─
  vehicle: defineEntity({
    schema: vehicleSchema,
    input: formToVehicleInput,
    requiresModule: "VEHICLES",
    create: async (data, { userId }) => {
      const vehicle = await createVehicleCommand(data, userId);
      return { id: vehicle.id };
    },
    update: async (id, data, ctx) => {
      await updateVehicleCommand(id, data, ctx.userId, { baseUpdatedAt: ctx.baseUpdatedAt });
    },
    // #287 — soft-delete, matching deleteVehicle in actions/vehicles.ts.
    remove: async (id) => {
      await deleteVehicleCommand(id);
    },
  }),

  vehicleItem: defineEntity({
    schema: vehicleItemSchema,
    input: formToVehicleItemInput,
    requiresModule: "VEHICLES",
    create: async (data, ctx) => {
      const item = await createServiceRecordCommand(requireParentId(ctx), data);
      return { id: item.id };
    },
    update: async (id, data, ctx) => {
      await updateServiceRecordCommand(id, data, {
        vehicleId: requireParentId(ctx),
        baseUpdatedAt: ctx.baseUpdatedAt,
      });
    },
    saveFile: async (vehicleItemId, file) => {
      validateFile(file);
      await addDocumentCommand("VEHICLE_ITEM", vehicleItemId, { file });
    },
  }),

  // ── Travel (household-shared) ──────────────────────────────────────────────
  trip: defineEntity({
    schema: tripSchema,
    input: formToTripInput,
    requiresModule: "TRAVEL",
    create: async (data, { userId }) => {
      const trip = await createTripCommand(data, userId);
      return { id: trip.id };
    },
    update: async (id, data, ctx) => {
      await updateTripCommand(id, data, ctx.userId, { baseUpdatedAt: ctx.baseUpdatedAt });
    },
    // #287 — soft-delete, matching deleteTrip in actions/trips.ts.
    remove: async (id) => {
      await deleteTripCommand(id);
    },
  }),

  tripSegment: defineEntity({
    schema: tripSegmentSchema,
    input: formToTripSegmentInput,
    requiresModule: "TRAVEL",
    create: async (data, ctx) => {
      const segment = await createTripSegmentCommand(requireParentId(ctx), data);
      return { id: segment.id };
    },
    update: async (id, data, ctx) => {
      await updateTripSegmentCommand(id, data, {
        tripId: requireParentId(ctx),
        baseUpdatedAt: ctx.baseUpdatedAt,
      });
    },
    saveFile: async (segmentId, file) => {
      validateFile(file);
      await addDocumentCommand("TRIP_SEGMENT", segmentId, { file });
    },
  }),

  // ── Home (household-shared) ────────────────────────────────────────────────
  property: defineEntity({
    schema: propertySchema,
    input: formToPropertyInput,
    requiresModule: "HOME",
    create: async (data, { userId }) => {
      const property = await prisma.property.create({ data: { ...data, createdById: userId } });
      revalidatePath("/home");
      return { id: property.id };
    },
    update: async (id, data, ctx) => {
      const existing = await prisma.property.findUnique({ where: { id } });
      if (!existing) throw new Error("Property not found");
      await updateUnlessStale(ctx.baseUpdatedAt, (guard) =>
        prisma.property.updateMany({ where: { id, ...guard }, data }),
      );
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
    input: formToHomeItemInput,
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
      await updateUnlessStale(ctx.baseUpdatedAt, (guard) =>
        prisma.homeItem.updateMany({ where: { id, ...guard }, data }),
      );
      revalidatePath(`/home/${propertyId}`);
    },
    saveFile: async (homeItemId, file) => {
      validateFile(file);
      await addDocumentCommand("HOME_ITEM", homeItemId, { file });
    },
  }),

  // Note: RentalAgreement has no `updatedAt` field in the schema (unlike every
  // other model here) — it's exempt from the Phase 6 conflict check.
  rentalAgreement: defineEntity({
    schema: rentalAgreementSchema,
    input: formToRentalAgreementInput,
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
    input: formToRentalStatementInput,
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
      await updateUnlessStale(ctx.baseUpdatedAt, (guard) =>
        prisma.rentalStatement.updateMany({ where: { id, ...guard }, data }),
      );
      revalidatePath(`/home/${propertyId}/rental`);
    },
    saveFile: async (statementId, file) => {
      validateFile(file);
      await addDocumentCommand("RENTAL_STATEMENT", statementId, { file });
    },
  }),

  // ── Inventory (per-user ownership) ─────────────────────────────────────────
  inventoryItem: defineEntity({
    schema: inventoryItemSchema,
    input: formToInventoryItemInput,
    requiresModule: "INVENTORY",
    create: async (data, { userId }) => {
      const item = await prisma.inventoryItem.create({ data: { ...data, createdById: userId } });
      revalidatePath("/inventory");
      return { id: item.id };
    },
    update: async (id, data, ctx) => {
      const existing = await prisma.inventoryItem.findUnique({ where: { id } });
      if (!existing) throw new Error("Item not found");
      await updateUnlessStale(ctx.baseUpdatedAt, (guard) =>
        prisma.inventoryItem.updateMany({ where: { id, ...guard }, data }),
      );
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
      await addDocumentCommand("INVENTORY_ITEM", itemId, { file });
    },
  }),

  // ── Wealth (household-wide, like every other module) ──────────────────────
  portfolio: defineEntity({
    schema: portfolioSchema,
    input: formToPortfolioInput,
    requiresModule: "WEALTH",
    create: async (data, { userId }) => {
      const portfolio = await prisma.portfolio.create({ data: { ...data, createdById: userId } });
      revalidatePath("/wealth");
      return { id: portfolio.id };
    },
    update: async (id, data, ctx) => {
      const existing = await prisma.portfolio.findUnique({ where: { id } });
      if (!existing) throw new Error("Portfolio not found");
      await updateUnlessStale(ctx.baseUpdatedAt, (guard) =>
        prisma.portfolio.updateMany({ where: { id, ...guard }, data }),
      );
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
          await removeOwnerDocumentFiles("TRADE", trade.id);
        }
      }
      await prisma.portfolio.delete({ where: { id } });
      revalidatePath("/wealth");
    },
  }),

  holding: defineEntity({
    schema: holdingSchema,
    input: formToHoldingInput,
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
      await updateUnlessStale(ctx.baseUpdatedAt, (guard) =>
        prisma.holding.updateMany({ where: { id, ...guard }, data }),
      );
      revalidatePath(`/wealth/portfolios/${holding.portfolioId}/holdings/${id}`);
    },
  }),

  trade: defineEntity({
    schema: tradeSchema,
    input: formToTradeInput,
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
      await updateUnlessStale(ctx.baseUpdatedAt, (guard) =>
        prisma.trade.updateMany({ where: { id, ...guard }, data }),
      );
      revalidatePath(`/wealth/portfolios/${holding.portfolioId}/holdings/${holdingId}`);
    },
    saveFile: async (tradeId, file) => {
      validateFile(file);
      await addDocumentCommand("TRADE", tradeId, { file });
    },
  }),

  // No update action exists for PropertyValuation in the live app (create + delete
  // only) — offline queue never produces an "update" for it, so `update` is omitted.
  propertyValuation: defineEntity({
    schema: propertyValuationSchema,
    input: formToPropertyValuationInput,
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
  // #396: one entity for every kind, a soft delete to Trash like the live
  // deleteDocumentAction. ctx.kind says which table; ctx.parentId, when
  // sent, is the owner record the list showed it under. The module gate is
  // the command's (by kind), so there's no static requiresModule here.
  document: defineEntity({
    // A delete for a Document that's already gone (purged from Trash, or
    // deleted elsewhere since the op was queued) has nothing left to do, so
    // it succeeds rather than failing the sync. Already in Trash is a no-op
    // in the command.
    remove: async (documentId, ctx) => {
      const doc = isOwnedDocumentKind(ctx.kind)
        ? await findDocument(ctx.kind, documentId)
        : await findDocumentAnyKind(documentId);
      if (!doc) return;
      await deleteDocumentCommand(doc.kind, documentId, { ownerId: ctx.parentId });
    },
  }),
};

export interface SyncOperationShape {
  entity: string;
  parentId?: string;
  kind?: string;
}

// Ops queued offline before #396 name one `*Document` entity per kind
// (contractDocument, tripSegmentDocument, …). They're mapped onto the
// `document` entity here, so a queue saved before the upgrade still syncs.
// A legacy tradeDocument op's parentId was the Holding, not the Trade, so
// it's dropped rather than used as the owner scope.
export function normalizeSyncOperation<T extends SyncOperationShape>(op: T): T {
  const legacy = LEGACY_DOCUMENT_SYNC_ENTITIES[op.entity];
  if (!legacy) return op;
  return {
    ...op,
    entity: "document",
    kind: legacy.kind,
    parentId: legacy.parentIsOwner ? op.parentId : undefined,
  };
}
