import { MODULE_KEYS, type ModuleKey } from "@/lib/modules/registry";
import { contractSchema } from "@/lib/validation/contract";
import { productSchema } from "@/lib/validation/product";
import { vehicleItemSchema, vehicleSchema } from "@/lib/validation/vehicles";
import type {
  MobileAttachmentInput,
  MobileListOptions,
  MobileListResult,
  MobileMutationOptions,
  MobileRepositories,
} from "@/lib/mobile/repositories";
import type {
  MobileContractDto,
  MobileContractInput,
  MobileDashboardSummaryDto,
  MobileDocumentDto,
  MobileDocumentOwnerType,
  MobileModuleSettingDto,
  MobileProductDto,
  MobileProductInput,
  MobileRecordId,
  MobileVehicleDto,
  MobileVehicleInput,
  MobileVehicleItemDto,
  MobileVehicleItemInput,
} from "@/lib/mobile/dtos";
import {
  createStandaloneId,
  getStandaloneDb,
  nowIso,
  type StandaloneContractRecord,
  type StandaloneDocumentRecord,
  type StandaloneProductRecord,
  type StandaloneVehicleItemRecord,
  type StandaloneVehicleRecord,
} from "@/lib/mobile/standaloneStore";

const DEFAULT_REMINDER_DAYS = "30,14,7,1";
const EXPIRING_SOON_DAYS = 30;

function assertExpectedVersion(
  existing: { version: number },
  options?: MobileMutationOptions,
): void {
  if (options?.expectedVersion == null) return;
  if (String(existing.version) !== String(options.expectedVersion)) {
    throw new Error("This record has changed since it was opened.");
  }
}

function nullableString(value: string | null | undefined): string | null {
  return value?.trim() ? value.trim() : null;
}

function nullableIsoDate(
  value: Date | string | null | undefined,
): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function matchesSearch(values: Array<string | null>, search?: string): boolean {
  if (!search?.trim()) return true;
  const needle = search.trim().toLocaleLowerCase();
  return values.some((value) => value?.toLocaleLowerCase().includes(needle));
}

function paginate<T extends { id: string; updatedAt: string }>(
  records: T[],
  options?: MobileListOptions,
): MobileListResult<T> {
  const sorted = [...records].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const start = options?.cursor
    ? Math.max(
        sorted.findIndex((record) => record.id === options.cursor) + 1,
        0,
      )
    : 0;
  const limit = options?.limit ?? 50;
  const items = sorted.slice(start, start + limit);
  const nextCursor =
    start + limit < sorted.length ? (items.at(-1)?.id ?? null) : null;
  return { items, nextCursor };
}

async function countDocuments(
  ownerType: MobileDocumentOwnerType,
  ownerId: string,
): Promise<number> {
  const db = await getStandaloneDb();
  const docs = await db.getAllFromIndex("documents", "by-owner", [
    ownerType,
    ownerId,
  ]);
  return docs.filter((doc) => !doc.deletedAt).length;
}

async function toContractDto(
  record: StandaloneContractRecord,
): Promise<MobileContractDto> {
  return {
    ...record,
    documentCount: await countDocuments("contract", record.id),
  };
}

async function toProductDto(
  record: StandaloneProductRecord,
): Promise<MobileProductDto> {
  return {
    ...record,
    documentCount: await countDocuments("product", record.id),
  };
}

async function toVehicleDto(
  record: StandaloneVehicleRecord,
): Promise<MobileVehicleDto> {
  const db = await getStandaloneDb();
  const items = await db.getAllFromIndex(
    "vehicleItems",
    "by-vehicle",
    record.id,
  );
  return {
    ...record,
    itemCount: items.filter((item) => !item.deletedAt).length,
  };
}

async function toVehicleItemDto(
  record: StandaloneVehicleItemRecord,
): Promise<MobileVehicleItemDto> {
  return {
    ...record,
    documentCount: await countDocuments("vehicleItem", record.id),
  };
}

function toDocumentDto(record: StandaloneDocumentRecord): MobileDocumentDto {
  return {
    id: record.id,
    ownerType: record.ownerType,
    ownerId: record.ownerId,
    filename: record.filename,
    storageKey: record.storageKey,
    mimeType: record.mimeType,
    size: record.size,
    kind: record.kind,
    extractedText: record.extractedText,
    uploadedAt: record.uploadedAt,
    version: record.version,
  };
}

function buildContractRecord(
  input: MobileContractInput,
  existing?: StandaloneContractRecord,
): StandaloneContractRecord {
  const parsed = contractSchema.parse(input);
  const timestamp = nowIso();
  return {
    id: existing?.id ?? createStandaloneId("contract"),
    title: parsed.title,
    category: parsed.category,
    provider: parsed.provider,
    contractNumber: nullableString(parsed.contractNumber),
    startDate: nullableIsoDate(parsed.startDate),
    endDate: nullableIsoDate(parsed.endDate),
    renewalType: parsed.renewalType,
    noticePeriodDays: parsed.noticePeriodDays ?? null,
    cost: parsed.cost ?? null,
    currency: parsed.currency,
    billingFrequency: parsed.billingFrequency ?? null,
    status: parsed.status,
    contactName: nullableString(parsed.contactName),
    contactPhone: nullableString(parsed.contactPhone),
    contactEmail: nullableString(parsed.contactEmail),
    notes: nullableString(parsed.notes),
    reminderDaysBefore:
      nullableString(parsed.reminderDaysBefore) ?? DEFAULT_REMINDER_DAYS,
    isTaxDeductible: parsed.isTaxDeductible,
    propertyId: nullableString(parsed.propertyId),
    vehicleId: nullableString(parsed.vehicleId),
    deletedAt: null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    version: existing ? existing.version + 1 : 1,
  };
}

function buildProductRecord(
  input: MobileProductInput,
  existing?: StandaloneProductRecord,
): StandaloneProductRecord {
  const parsed = productSchema.parse(input);
  const timestamp = nowIso();
  return {
    id: existing?.id ?? createStandaloneId("product"),
    description: parsed.description,
    manufacturer: nullableString(parsed.manufacturer),
    model: nullableString(parsed.model),
    vendor: nullableString(parsed.vendor),
    serialNumber: nullableString(parsed.serialNumber),
    barcode: nullableString(parsed.barcode),
    purchaseDate: nullableIsoDate(parsed.purchaseDate),
    warrantyEndDate: nullableIsoDate(parsed.warrantyEndDate),
    price: parsed.price ?? null,
    currency: parsed.currency,
    notes: nullableString(parsed.notes),
    reminderDaysBefore:
      nullableString(parsed.reminderDaysBefore) ?? DEFAULT_REMINDER_DAYS,
    propertyId: nullableString(parsed.propertyId),
    deletedAt: null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    version: existing ? existing.version + 1 : 1,
  };
}

function buildVehicleRecord(
  input: MobileVehicleInput,
  existing?: StandaloneVehicleRecord,
): StandaloneVehicleRecord {
  const parsed = vehicleSchema.parse(input);
  const timestamp = nowIso();
  return {
    id: existing?.id ?? createStandaloneId("vehicle"),
    label: parsed.label,
    make: nullableString(parsed.make),
    model: nullableString(parsed.model),
    year: parsed.year ?? null,
    colour: nullableString(parsed.colour),
    licensePlate: nullableString(parsed.licensePlate),
    vin: nullableString(parsed.vin),
    regoExpiry: nullableIsoDate(parsed.regoExpiry),
    insuranceExpiry: nullableIsoDate(parsed.insuranceExpiry),
    reminderDaysBefore:
      nullableString(parsed.reminderDaysBefore) ?? DEFAULT_REMINDER_DAYS,
    notes: nullableString(parsed.notes),
    deletedAt: null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    version: existing ? existing.version + 1 : 1,
  };
}

function buildVehicleItemRecord(
  vehicleId: string,
  input: MobileVehicleItemInput,
  existing?: StandaloneVehicleItemRecord,
): StandaloneVehicleItemRecord {
  const parsed = vehicleItemSchema.parse(input);
  const timestamp = nowIso();
  return {
    id: existing?.id ?? createStandaloneId("vehicle_item"),
    vehicleId,
    type: parsed.type,
    title: parsed.title,
    provider: nullableString(parsed.provider),
    date: nullableIsoDate(parsed.date),
    cost: parsed.cost ?? null,
    currency: parsed.currency,
    notes: nullableString(parsed.notes),
    deletedAt: null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    version: existing ? existing.version + 1 : 1,
  };
}

async function softDeleteDocuments(
  ownerType: MobileDocumentOwnerType,
  ownerId: string,
  timestamp: string,
): Promise<void> {
  const db = await getStandaloneDb();
  const tx = db.transaction("documents", "readwrite");
  const docs = await tx.store.index("by-owner").getAll([ownerType, ownerId]);
  await Promise.all(
    docs
      .filter((doc) => !doc.deletedAt)
      .map((doc) =>
        tx.store.put({
          ...doc,
          deletedAt: timestamp,
          version: doc.version + 1,
        }),
      ),
  );
  await tx.done;
}

export const standaloneRepositories: MobileRepositories = {
  contracts: {
    async list(options) {
      const db = await getStandaloneDb();
      const records = (await db.getAll("contracts")).filter(
        (record) =>
          !record.deletedAt &&
          matchesSearch(
            [
              record.title,
              record.provider,
              record.contractNumber,
              record.notes,
            ],
            options?.search,
          ),
      );
      const result = paginate(records, options);
      return {
        ...result,
        items: await Promise.all(result.items.map(toContractDto)),
      };
    },
    async get(id) {
      const db = await getStandaloneDb();
      const record = await db.get("contracts", id);
      return record && !record.deletedAt ? toContractDto(record) : null;
    },
    async create(input) {
      const record = buildContractRecord(input);
      const db = await getStandaloneDb();
      await db.add("contracts", record);
      return toContractDto(record);
    },
    async update(id, input, options) {
      const db = await getStandaloneDb();
      const existing = await db.get("contracts", id);
      if (!existing || existing.deletedAt)
        throw new Error("Contract not found");
      assertExpectedVersion(existing, options);
      const record = buildContractRecord(input, existing);
      await db.put("contracts", record);
      return toContractDto(record);
    },
    async remove(id, options) {
      const db = await getStandaloneDb();
      const existing = await db.get("contracts", id);
      if (!existing || existing.deletedAt) return;
      assertExpectedVersion(existing, options);
      const timestamp = nowIso();
      await db.put("contracts", {
        ...existing,
        deletedAt: timestamp,
        updatedAt: timestamp,
        version: existing.version + 1,
      });
      await softDeleteDocuments("contract", id, timestamp);
    },
  },
  products: {
    async list(options) {
      const db = await getStandaloneDb();
      const records = (await db.getAll("products")).filter(
        (record) =>
          !record.deletedAt &&
          matchesSearch(
            [
              record.description,
              record.manufacturer,
              record.model,
              record.vendor,
              record.serialNumber,
              record.notes,
            ],
            options?.search,
          ),
      );
      const result = paginate(records, options);
      return {
        ...result,
        items: await Promise.all(result.items.map(toProductDto)),
      };
    },
    async get(id) {
      const db = await getStandaloneDb();
      const record = await db.get("products", id);
      return record && !record.deletedAt ? toProductDto(record) : null;
    },
    async create(input) {
      const record = buildProductRecord(input);
      const db = await getStandaloneDb();
      await db.add("products", record);
      return toProductDto(record);
    },
    async update(id, input, options) {
      const db = await getStandaloneDb();
      const existing = await db.get("products", id);
      if (!existing || existing.deletedAt) throw new Error("Product not found");
      assertExpectedVersion(existing, options);
      const record = buildProductRecord(input, existing);
      await db.put("products", record);
      return toProductDto(record);
    },
    async remove(id, options) {
      const db = await getStandaloneDb();
      const existing = await db.get("products", id);
      if (!existing || existing.deletedAt) return;
      assertExpectedVersion(existing, options);
      const timestamp = nowIso();
      await db.put("products", {
        ...existing,
        deletedAt: timestamp,
        updatedAt: timestamp,
        version: existing.version + 1,
      });
      await softDeleteDocuments("product", id, timestamp);
    },
  },
  documents: {
    async listForOwner(ownerType, ownerId) {
      const db = await getStandaloneDb();
      const docs = await db.getAllFromIndex("documents", "by-owner", [
        ownerType,
        ownerId,
      ]);
      return docs.filter((doc) => !doc.deletedAt).map(toDocumentDto);
    },
    async get(id) {
      const db = await getStandaloneDb();
      const record = await db.get("documents", id);
      return record && !record.deletedAt ? toDocumentDto(record) : null;
    },
    async attach(input: MobileAttachmentInput) {
      const db = await getStandaloneDb();
      const timestamp = nowIso();
      const record: StandaloneDocumentRecord = {
        id: createStandaloneId("document"),
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        filename: input.filename,
        storageKey: input.fileUri ?? createStandaloneId("file"),
        mimeType: input.mimeType,
        size: input.size,
        kind: input.kind ?? null,
        extractedText: null,
        uploadedAt: timestamp,
        deletedAt: null,
        version: 1,
        blob: input.blob,
        fileUri: input.fileUri,
      };
      await db.add("documents", record);
      return toDocumentDto(record);
    },
    async remove(id, options) {
      const db = await getStandaloneDb();
      const existing = await db.get("documents", id);
      if (!existing || existing.deletedAt) return;
      assertExpectedVersion(existing, options);
      await db.put("documents", {
        ...existing,
        deletedAt: nowIso(),
        version: existing.version + 1,
      });
    },
  },
  modules: {
    async list() {
      const db = await getStandaloneDb();
      const existing = await db.getAll("modules");
      const byKey = new Map(existing.map((item) => [item.key, item]));
      return MODULE_KEYS.map((key) => {
        const item = byKey.get(key);
        return {
          key,
          enabled: item?.enabled ?? false,
          updatedAt: item?.updatedAt ?? new Date(0).toISOString(),
        } satisfies MobileModuleSettingDto;
      });
    },
    async setEnabled(key: ModuleKey, enabled: boolean) {
      const db = await getStandaloneDb();
      const timestamp = nowIso();
      const existing = await db.get("modules", key);
      const record = {
        key,
        enabled,
        updatedAt: timestamp,
        version: existing ? existing.version + 1 : 1,
      };
      await db.put("modules", record);
      return { key, enabled, updatedAt: timestamp };
    },
  },
  dashboard: {
    async getSummary(): Promise<MobileDashboardSummaryDto> {
      const db = await getStandaloneDb();
      const [contracts, products, vehicles] = await Promise.all([
        db.getAll("contracts"),
        db.getAll("products"),
        db.getAll("vehicles"),
      ]);
      const now = Date.now();
      const expiringBefore = now + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000;
      const activeContracts = contracts.filter(
        (item) => !item.deletedAt && item.status === "ACTIVE",
      );
      const liveProducts = products.filter((item) => !item.deletedAt);
      const liveVehicles = vehicles.filter((item) => !item.deletedAt);
      const monthlySpend = activeContracts.reduce((sum, item) => {
        if (!item.cost) return sum;
        if (item.billingFrequency === "WEEKLY")
          return sum + (item.cost * 52) / 12;
        if (item.billingFrequency === "QUARTERLY") return sum + item.cost / 3;
        if (item.billingFrequency === "ANNUALLY") return sum + item.cost / 12;
        if (item.billingFrequency === "MONTHLY") return sum + item.cost;
        return sum;
      }, 0);

      return {
        activeContracts: activeContracts.length,
        expiringContracts: activeContracts.filter((item) => {
          if (!item.endDate) return false;
          const time = new Date(item.endDate).getTime();
          return time >= now && time <= expiringBefore;
        }).length,
        expiredContracts: activeContracts.filter(
          (item) => item.endDate && new Date(item.endDate).getTime() < now,
        ).length,
        productsInWarranty: liveProducts.filter(
          (item) =>
            item.warrantyEndDate &&
            new Date(item.warrantyEndDate).getTime() >= now,
        ).length,
        productsExpiring: liveProducts.filter((item) => {
          if (!item.warrantyEndDate) return false;
          const time = new Date(item.warrantyEndDate).getTime();
          return time >= now && time <= expiringBefore;
        }).length,
        productsExpired: liveProducts.filter(
          (item) =>
            item.warrantyEndDate &&
            new Date(item.warrantyEndDate).getTime() < now,
        ).length,
        vehicleCount: liveVehicles.length,
        upcomingVehicleExpiries: liveVehicles.filter((item) =>
          [item.regoExpiry, item.insuranceExpiry].some((date) => {
            if (!date) return false;
            const time = new Date(date).getTime();
            return time >= now && time <= expiringBefore;
          }),
        ).length,
        estimatedMonthlySpend: monthlySpend,
        currency:
          activeContracts[0]?.currency ?? liveProducts[0]?.currency ?? "AUD",
      };
    },
  },
  vehicles: {
    async list(options) {
      const db = await getStandaloneDb();
      const records = (await db.getAll("vehicles")).filter(
        (record) =>
          !record.deletedAt &&
          matchesSearch(
            [
              record.label,
              record.make,
              record.model,
              record.licensePlate,
              record.vin,
              record.notes,
            ],
            options?.search,
          ),
      );
      const result = paginate(records, options);
      return {
        ...result,
        items: await Promise.all(result.items.map(toVehicleDto)),
      };
    },
    async get(id) {
      const db = await getStandaloneDb();
      const record = await db.get("vehicles", id);
      return record && !record.deletedAt ? toVehicleDto(record) : null;
    },
    async create(input) {
      const record = buildVehicleRecord(input);
      const db = await getStandaloneDb();
      await db.add("vehicles", record);
      return toVehicleDto(record);
    },
    async update(id, input, options) {
      const db = await getStandaloneDb();
      const existing = await db.get("vehicles", id);
      if (!existing || existing.deletedAt) throw new Error("Vehicle not found");
      assertExpectedVersion(existing, options);
      const record = buildVehicleRecord(input, existing);
      await db.put("vehicles", record);
      return toVehicleDto(record);
    },
    async remove(id, options) {
      const db = await getStandaloneDb();
      const existing = await db.get("vehicles", id);
      if (!existing || existing.deletedAt) return;
      assertExpectedVersion(existing, options);
      const timestamp = nowIso();
      const tx = db.transaction(["vehicles", "vehicleItems"], "readwrite");
      await tx.objectStore("vehicles").put({
        ...existing,
        deletedAt: timestamp,
        updatedAt: timestamp,
        version: existing.version + 1,
      });
      const items = await tx
        .objectStore("vehicleItems")
        .index("by-vehicle")
        .getAll(id);
      await Promise.all(
        items
          .filter((item) => !item.deletedAt)
          .map((item) =>
            tx.objectStore("vehicleItems").put({
              ...item,
              deletedAt: timestamp,
              updatedAt: timestamp,
              version: item.version + 1,
            }),
          ),
      );
      await tx.done;
      await Promise.all(
        items.map((item) =>
          softDeleteDocuments("vehicleItem", item.id, timestamp),
        ),
      );
    },
    async listItems(vehicleId) {
      const db = await getStandaloneDb();
      const records = await db.getAllFromIndex(
        "vehicleItems",
        "by-vehicle",
        vehicleId,
      );
      return Promise.all(
        records.filter((record) => !record.deletedAt).map(toVehicleItemDto),
      );
    },
    async createItem(vehicleId, input) {
      const db = await getStandaloneDb();
      const vehicle = await db.get("vehicles", vehicleId);
      if (!vehicle || vehicle.deletedAt) throw new Error("Vehicle not found");
      const record = buildVehicleItemRecord(vehicleId, input);
      await db.add("vehicleItems", record);
      return toVehicleItemDto(record);
    },
    async updateItem(vehicleId, itemId, input, options) {
      const db = await getStandaloneDb();
      const existing = await db.get("vehicleItems", itemId);
      if (!existing || existing.deletedAt || existing.vehicleId !== vehicleId)
        throw new Error("Vehicle item not found");
      assertExpectedVersion(existing, options);
      const record = buildVehicleItemRecord(vehicleId, input, existing);
      await db.put("vehicleItems", record);
      return toVehicleItemDto(record);
    },
    async removeItem(vehicleId, itemId, options) {
      const db = await getStandaloneDb();
      const existing = await db.get("vehicleItems", itemId);
      if (!existing || existing.deletedAt || existing.vehicleId !== vehicleId)
        return;
      assertExpectedVersion(existing, options);
      const timestamp = nowIso();
      await db.put("vehicleItems", {
        ...existing,
        deletedAt: timestamp,
        updatedAt: timestamp,
        version: existing.version + 1,
      });
      await softDeleteDocuments("vehicleItem", itemId, timestamp);
    },
  },
};

export async function getStandaloneDocumentBlob(
  id: MobileRecordId,
): Promise<Blob | null> {
  const db = await getStandaloneDb();
  const record = await db.get("documents", id);
  return record && !record.deletedAt ? (record.blob ?? null) : null;
}
