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
import {
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
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface EntitySyncConfig<T = any> {
  schema: ZodTypeAny;
  requiresModule?: ModuleKey;
  create: (data: T, ctx: SyncContext) => Promise<void>;
  // Entities with no online "edit" flow (e.g. PropertyValuation) omit update —
  // an offline "update" op for them is rejected as unsupported.
  update?: (id: string, data: T, ctx: SyncContext) => Promise<void>;
  // Only wired up for top-level entities with a ConfirmForm `offline` prop
  // (see ConfirmForm.tsx) — child-record and document deletes are deferred.
  remove?: (id: string, ctx: SyncContext) => Promise<void>;
}

function defineEntity<T>(config: EntitySyncConfig<T>): EntitySyncConfig<T> {
  return config;
}

function requireParentId(ctx: SyncContext): string {
  if (!ctx.parentId) throw new Error("Missing parent record");
  return ctx.parentId;
}

export const ENTITY_SYNC_CONFIGS: Record<string, EntitySyncConfig> = {
  // ── Contracts (always-on, per-user ownership) ──────────────────────────────
  contract: defineEntity({
    schema: contractSchema,
    create: async (data, { userId }) => {
      await prisma.contract.create({ data: { ...data, createdById: userId } });
      revalidatePath("/contracts");
    },
    update: async (id, data, { userId }) => {
      const existing = await prisma.contract.findUnique({ where: { id } });
      if (!existing || existing.createdById !== userId) throw new Error("Contract not found");
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
  }),

  // ── Products (always-on, per-user ownership) ───────────────────────────────
  product: defineEntity({
    schema: productSchema,
    create: async (data, { userId }) => {
      await prisma.product.create({ data: { ...data, createdById: userId } });
      revalidatePath("/products");
    },
    update: async (id, data, { userId }) => {
      const existing = await prisma.product.findUnique({ where: { id } });
      if (!existing || existing.createdById !== userId) throw new Error("Product not found");
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
  }),

  // ── Vehicles (household-shared — no ownership check, matches the live action) ─
  vehicle: defineEntity({
    schema: vehicleSchema,
    requiresModule: "VEHICLES",
    create: async (data, { userId }) => {
      await prisma.vehicle.create({ data: { ...data, createdById: userId } });
      revalidatePath("/vehicles");
    },
    update: async (id, data) => {
      const existing = await prisma.vehicle.findUnique({ where: { id } });
      if (!existing) throw new Error("Vehicle not found");
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
      await prisma.vehicleItem.create({ data: { ...data, vehicleId } });
      revalidatePath(`/vehicles/${vehicleId}`);
    },
    update: async (id, data, ctx) => {
      const vehicleId = requireParentId(ctx);
      const existing = await prisma.vehicleItem.findUnique({ where: { id } });
      if (!existing || existing.vehicleId !== vehicleId) throw new Error("Item not found");
      await prisma.vehicleItem.update({ where: { id }, data });
      revalidatePath(`/vehicles/${vehicleId}`);
    },
  }),

  // ── Travel (household-shared) ──────────────────────────────────────────────
  trip: defineEntity({
    schema: tripSchema,
    requiresModule: "TRAVEL",
    create: async (data, { userId }) => {
      await prisma.trip.create({ data: { ...data, createdById: userId } });
      revalidatePath("/travel");
    },
    update: async (id, data) => {
      const existing = await prisma.trip.findUnique({ where: { id } });
      if (!existing) throw new Error("Trip not found");
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
      await prisma.tripSegment.create({ data: { ...data, tripId } });
      revalidatePath(`/travel/${tripId}`);
    },
    update: async (id, data, ctx) => {
      const tripId = requireParentId(ctx);
      const existing = await prisma.tripSegment.findUnique({ where: { id } });
      if (!existing || existing.tripId !== tripId) throw new Error("Segment not found");
      await prisma.tripSegment.update({ where: { id }, data });
      revalidatePath(`/travel/${tripId}`);
    },
  }),

  // ── Home (household-shared) ────────────────────────────────────────────────
  property: defineEntity({
    schema: propertySchema,
    requiresModule: "HOME",
    create: async (data, { userId }) => {
      await prisma.property.create({ data: { ...data, createdById: userId } });
      revalidatePath("/home");
    },
    update: async (id, data) => {
      const existing = await prisma.property.findUnique({ where: { id } });
      if (!existing) throw new Error("Property not found");
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
      await prisma.homeItem.create({ data: { ...data, propertyId } });
      revalidatePath(`/home/${propertyId}`);
    },
    update: async (id, data, ctx) => {
      const propertyId = requireParentId(ctx);
      const existing = await prisma.homeItem.findUnique({ where: { id } });
      if (!existing || existing.propertyId !== propertyId) throw new Error("Item not found");
      await prisma.homeItem.update({ where: { id }, data });
      revalidatePath(`/home/${propertyId}`);
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
      await prisma.$transaction([
        prisma.rentalAgreement.create({ data: { ...data, propertyId } }),
        prisma.property.update({ where: { id: propertyId }, data: { isRented: true } }),
      ]);
      revalidatePath(`/home/${propertyId}`);
      revalidatePath(`/home/${propertyId}/rental`);
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
      await prisma.rentalStatement.create({ data: { ...data, propertyId } });
      revalidatePath(`/home/${propertyId}/rental`);
    },
    update: async (id, data, ctx) => {
      const propertyId = requireParentId(ctx);
      const existing = await prisma.rentalStatement.findUnique({ where: { id } });
      if (!existing || existing.propertyId !== propertyId) throw new Error("Statement not found");
      await prisma.rentalStatement.update({ where: { id }, data });
      revalidatePath(`/home/${propertyId}/rental`);
    },
  }),

  // ── Inventory (per-user ownership) ─────────────────────────────────────────
  inventoryItem: defineEntity({
    schema: inventoryItemSchema,
    requiresModule: "INVENTORY",
    create: async (data, { userId }) => {
      await prisma.inventoryItem.create({ data: { ...data, createdById: userId } });
      revalidatePath("/inventory");
    },
    update: async (id, data, { userId }) => {
      const existing = await prisma.inventoryItem.findUnique({ where: { id } });
      if (!existing || existing.createdById !== userId) throw new Error("Item not found");
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
  }),

  // ── Wealth (per-user ownership via portfolio.createdById) ──────────────────
  portfolio: defineEntity({
    schema: portfolioSchema,
    requiresModule: "WEALTH",
    create: async (data, { userId }) => {
      await prisma.portfolio.create({ data: { ...data, createdById: userId } });
      revalidatePath("/wealth");
    },
    update: async (id, data, { userId }) => {
      const existing = await prisma.portfolio.findUnique({ where: { id } });
      if (!existing || existing.createdById !== userId) throw new Error("Portfolio not found");
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
      await prisma.holding.create({ data: { ...data, portfolioId } });
      revalidatePath(`/wealth/portfolios/${portfolioId}`);
    },
    update: async (id, data, ctx) => {
      const holding = await prisma.holding.findUnique({
        where: { id },
        include: { portfolio: true },
      });
      if (!holding || holding.portfolio.createdById !== ctx.userId) throw new Error("Holding not found");
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
      await prisma.trade.update({ where: { id }, data });
      revalidatePath(`/wealth/portfolios/${holding.portfolioId}/holdings/${holdingId}`);
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
      await prisma.propertyValuation.create({ data: { ...data, propertyId } });
      revalidatePath(`/home/${propertyId}`);
    },
  }),
};
