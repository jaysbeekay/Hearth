import { MODULE_KEYS, type ModuleKey } from "@/lib/modules/registry";
import { contractSchema } from "@/lib/validation/contract";
import { productSchema } from "@/lib/validation/product";
import { vehicleItemSchema, vehicleSchema } from "@/lib/validation/vehicles";
import type {
  MobileContractDto,
  MobileDashboardSummaryDto,
  MobileDocumentDto,
  MobileDocumentOwnerType,
  MobileProductDto,
  MobileVehicleDto,
  MobileVehicleItemDto,
} from "@/lib/mobile/dtos";
import type {
  MobileAttachmentInput,
  MobileListOptions,
  MobileMutationOptions,
  MobileRepositories,
} from "@/lib/mobile/repositories";
import { deleteProtectedStandaloneFile, writeProtectedStandaloneFile } from "@/lib/mobile/nativeFileStorage";
import { nativeQuery, nativeRun, nativeRunSet } from "@/lib/mobile/nativeStandaloneStore";

const DEFAULT_REMINDER_DAYS = "30,14,7,1";
const EXPIRING_SOON_DAYS = 30;

type SqlRow = Record<string, unknown>;

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean {
  return value === true || value === 1;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function assertVersion(row: { version: number }, options?: MobileMutationOptions) {
  if (options?.expectedVersion == null) return;
  if (String(row.version) !== String(options.expectedVersion)) {
    throw new Error("This record has changed since it was opened.");
  }
}

function limit(options?: MobileListOptions): number {
  return Math.min(Math.max(options?.limit ?? 50, 1), 100);
}

function like(options?: MobileListOptions): string {
  return `%${options?.search?.trim() ?? ""}%`;
}

async function documentCount(ownerType: MobileDocumentOwnerType, ownerId: string): Promise<number> {
  const rows = await nativeQuery<{ count: number }>(
    "SELECT COUNT(*) AS count FROM documents WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL",
    [ownerType, ownerId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function assertDocumentOwnerExists(ownerType: MobileDocumentOwnerType, ownerId: string): Promise<void> {
  const table = documentOwnerTable(ownerType);
  const rows = await nativeQuery<{ id: string }>(`SELECT id FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [
    ownerId,
  ]);
  if (!rows[0]) {
    throw new Error("Attachment owner not found.");
  }
}

function documentOwnerTable(ownerType: MobileDocumentOwnerType): "contracts" | "products" | "vehicle_items" {
  if (ownerType === "contract") return "contracts";
  if (ownerType === "product") return "products";
  if (ownerType === "vehicleItem") return "vehicle_items";
  throw new Error(`${ownerType} attachments are not available in standalone mode yet.`);
}

async function contractDto(row: SqlRow): Promise<MobileContractDto> {
  return {
    id: String(row.id),
    version: Number(row.version),
    title: String(row.title),
    category: String(row.category) as MobileContractDto["category"],
    provider: String(row.provider),
    contractNumber: str(row.contract_number),
    startDate: str(row.start_date),
    endDate: str(row.end_date),
    renewalType: String(row.renewal_type) as MobileContractDto["renewalType"],
    noticePeriodDays: num(row.notice_period_days),
    cost: num(row.cost),
    currency: String(row.currency),
    billingFrequency: str(row.billing_frequency) as MobileContractDto["billingFrequency"],
    status: String(row.status) as MobileContractDto["status"],
    contactName: str(row.contact_name),
    contactPhone: str(row.contact_phone),
    contactEmail: str(row.contact_email),
    notes: str(row.notes),
    reminderDaysBefore: str(row.reminder_days_before),
    isTaxDeductible: bool(row.is_tax_deductible),
    propertyId: str(row.property_id),
    vehicleId: str(row.vehicle_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    documentCount: await documentCount("contract", String(row.id)),
  };
}

async function productDto(row: SqlRow): Promise<MobileProductDto> {
  return {
    id: String(row.id),
    version: Number(row.version),
    description: String(row.description),
    manufacturer: str(row.manufacturer),
    model: str(row.model),
    vendor: str(row.vendor),
    serialNumber: str(row.serial_number),
    barcode: str(row.barcode),
    purchaseDate: str(row.purchase_date),
    warrantyEndDate: str(row.warranty_end_date),
    price: num(row.price),
    currency: String(row.currency),
    notes: str(row.notes),
    reminderDaysBefore: str(row.reminder_days_before),
    propertyId: str(row.property_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    documentCount: await documentCount("product", String(row.id)),
  };
}

async function vehicleDto(row: SqlRow): Promise<MobileVehicleDto> {
  const countRows = await nativeQuery<{ count: number }>(
    "SELECT COUNT(*) AS count FROM vehicle_items WHERE vehicle_id = ? AND deleted_at IS NULL",
    [String(row.id)],
  );
  return {
    id: String(row.id),
    version: Number(row.version),
    label: String(row.label),
    make: str(row.make),
    model: str(row.model),
    year: num(row.year),
    colour: str(row.colour),
    licensePlate: str(row.license_plate),
    vin: str(row.vin),
    regoExpiry: str(row.rego_expiry),
    insuranceExpiry: str(row.insurance_expiry),
    reminderDaysBefore: str(row.reminder_days_before),
    notes: str(row.notes),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    itemCount: Number(countRows[0]?.count ?? 0),
  };
}

async function vehicleItemDto(row: SqlRow): Promise<MobileVehicleItemDto> {
  return {
    id: String(row.id),
    version: Number(row.version),
    vehicleId: String(row.vehicle_id),
    type: String(row.type) as MobileVehicleItemDto["type"],
    title: String(row.title),
    provider: str(row.provider),
    date: str(row.date),
    cost: num(row.cost),
    currency: String(row.currency),
    notes: str(row.notes),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    documentCount: await documentCount("vehicleItem", String(row.id)),
  };
}

function documentDto(row: SqlRow): MobileDocumentDto {
  return {
    id: String(row.id),
    ownerType: String(row.owner_type) as MobileDocumentOwnerType,
    ownerId: String(row.owner_id),
    filename: String(row.filename),
    storageKey: String(row.storage_key),
    mimeType: String(row.mime_type),
    size: Number(row.size),
    kind: str(row.kind) as MobileDocumentDto["kind"],
    extractedText: str(row.extracted_text),
    uploadedAt: String(row.uploaded_at),
    version: Number(row.version),
  };
}

export const nativeStandaloneRepositories: MobileRepositories = {
  contracts: {
    async list(options) {
      const hasSearch = Boolean(options?.search?.trim());
      const rows = await nativeQuery(
        `SELECT * FROM contracts
         WHERE deleted_at IS NULL
         ${hasSearch ? "AND (title LIKE ? OR provider LIKE ? OR contract_number LIKE ? OR notes LIKE ?)" : ""}
         ORDER BY updated_at DESC LIMIT ?`,
        hasSearch ? [like(options), like(options), like(options), like(options), limit(options)] : [limit(options)],
      );
      return { items: await Promise.all(rows.map(contractDto)), nextCursor: null };
    },
    async get(recordId) {
      const rows = await nativeQuery("SELECT * FROM contracts WHERE id = ? AND deleted_at IS NULL", [recordId]);
      return rows[0] ? contractDto(rows[0]) : null;
    },
    async create(input) {
      const parsed = contractSchema.parse(input);
      const timestamp = nowIso();
      const recordId = id("contract");
      await nativeRun(
        `INSERT INTO contracts (
          id, title, category, provider, contract_number, start_date, end_date, renewal_type,
          notice_period_days, cost, currency, billing_frequency, status, contact_name, contact_phone,
          contact_email, notes, reminder_days_before, is_tax_deductible, property_id, vehicle_id,
          created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          recordId,
          parsed.title,
          parsed.category,
          parsed.provider,
          str(parsed.contractNumber),
          iso(parsed.startDate),
          iso(parsed.endDate),
          parsed.renewalType,
          parsed.noticePeriodDays ?? null,
          parsed.cost ?? null,
          parsed.currency,
          parsed.billingFrequency ?? null,
          parsed.status,
          str(parsed.contactName),
          str(parsed.contactPhone),
          str(parsed.contactEmail),
          str(parsed.notes),
          str(parsed.reminderDaysBefore) ?? DEFAULT_REMINDER_DAYS,
          parsed.isTaxDeductible ? 1 : 0,
          str(parsed.propertyId),
          str(parsed.vehicleId),
          timestamp,
          timestamp,
        ],
      );
      return (await this.get(recordId)) as MobileContractDto;
    },
    async update(recordId, input, options) {
      const existing = await nativeQuery<{ version: number }>(
        "SELECT version FROM contracts WHERE id = ? AND deleted_at IS NULL",
        [recordId],
      );
      if (!existing[0]) throw new Error("Contract not found");
      assertVersion(existing[0], options);
      const parsed = contractSchema.parse(input);
      await nativeRun(
        `UPDATE contracts SET
          title = ?, category = ?, provider = ?, contract_number = ?, start_date = ?, end_date = ?,
          renewal_type = ?, notice_period_days = ?, cost = ?, currency = ?, billing_frequency = ?,
          status = ?, contact_name = ?, contact_phone = ?, contact_email = ?, notes = ?,
          reminder_days_before = ?, is_tax_deductible = ?, property_id = ?, vehicle_id = ?,
          updated_at = ?, version = version + 1
        WHERE id = ? AND deleted_at IS NULL`,
        [
          parsed.title,
          parsed.category,
          parsed.provider,
          str(parsed.contractNumber),
          iso(parsed.startDate),
          iso(parsed.endDate),
          parsed.renewalType,
          parsed.noticePeriodDays ?? null,
          parsed.cost ?? null,
          parsed.currency,
          parsed.billingFrequency ?? null,
          parsed.status,
          str(parsed.contactName),
          str(parsed.contactPhone),
          str(parsed.contactEmail),
          str(parsed.notes),
          str(parsed.reminderDaysBefore) ?? DEFAULT_REMINDER_DAYS,
          parsed.isTaxDeductible ? 1 : 0,
          str(parsed.propertyId),
          str(parsed.vehicleId),
          nowIso(),
          recordId,
        ],
      );
      return (await this.get(recordId)) as MobileContractDto;
    },
    async remove(recordId, options) {
      const existing = await nativeQuery<{ version: number }>(
        "SELECT version FROM contracts WHERE id = ? AND deleted_at IS NULL",
        [recordId],
      );
      if (!existing[0]) return;
      assertVersion(existing[0], options);
      const timestamp = nowIso();
      await nativeRunSet([
        {
          statement: "UPDATE contracts SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?",
          values: [timestamp, timestamp, recordId],
        },
        {
          statement: "UPDATE documents SET deleted_at = ?, version = version + 1 WHERE owner_type = ? AND owner_id = ?",
          values: [timestamp, "contract", recordId],
        },
      ]);
    },
  },
  products: {
    async list(options) {
      const hasSearch = Boolean(options?.search?.trim());
      const rows = await nativeQuery(
        `SELECT * FROM products
         WHERE deleted_at IS NULL
         ${hasSearch ? "AND (description LIKE ? OR manufacturer LIKE ? OR model LIKE ? OR vendor LIKE ? OR serial_number LIKE ? OR notes LIKE ?)" : ""}
         ORDER BY updated_at DESC LIMIT ?`,
        hasSearch
          ? [like(options), like(options), like(options), like(options), like(options), like(options), limit(options)]
          : [limit(options)],
      );
      return { items: await Promise.all(rows.map(productDto)), nextCursor: null };
    },
    async get(recordId) {
      const rows = await nativeQuery("SELECT * FROM products WHERE id = ? AND deleted_at IS NULL", [recordId]);
      return rows[0] ? productDto(rows[0]) : null;
    },
    async create(input) {
      const parsed = productSchema.parse(input);
      const timestamp = nowIso();
      const recordId = id("product");
      await nativeRun(
        `INSERT INTO products (
          id, description, manufacturer, model, vendor, serial_number, barcode, purchase_date,
          warranty_end_date, price, currency, notes, reminder_days_before, property_id,
          created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          recordId,
          parsed.description,
          str(parsed.manufacturer),
          str(parsed.model),
          str(parsed.vendor),
          str(parsed.serialNumber),
          str(parsed.barcode),
          iso(parsed.purchaseDate),
          iso(parsed.warrantyEndDate),
          parsed.price ?? null,
          parsed.currency,
          str(parsed.notes),
          str(parsed.reminderDaysBefore) ?? DEFAULT_REMINDER_DAYS,
          str(parsed.propertyId),
          timestamp,
          timestamp,
        ],
      );
      return (await this.get(recordId)) as MobileProductDto;
    },
    async update(recordId, input, options) {
      const existing = await nativeQuery<{ version: number }>(
        "SELECT version FROM products WHERE id = ? AND deleted_at IS NULL",
        [recordId],
      );
      if (!existing[0]) throw new Error("Product not found");
      assertVersion(existing[0], options);
      const parsed = productSchema.parse(input);
      await nativeRun(
        `UPDATE products SET
          description = ?, manufacturer = ?, model = ?, vendor = ?, serial_number = ?, barcode = ?,
          purchase_date = ?, warranty_end_date = ?, price = ?, currency = ?, notes = ?,
          reminder_days_before = ?, property_id = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND deleted_at IS NULL`,
        [
          parsed.description,
          str(parsed.manufacturer),
          str(parsed.model),
          str(parsed.vendor),
          str(parsed.serialNumber),
          str(parsed.barcode),
          iso(parsed.purchaseDate),
          iso(parsed.warrantyEndDate),
          parsed.price ?? null,
          parsed.currency,
          str(parsed.notes),
          str(parsed.reminderDaysBefore) ?? DEFAULT_REMINDER_DAYS,
          str(parsed.propertyId),
          nowIso(),
          recordId,
        ],
      );
      return (await this.get(recordId)) as MobileProductDto;
    },
    async remove(recordId, options) {
      const existing = await nativeQuery<{ version: number }>(
        "SELECT version FROM products WHERE id = ? AND deleted_at IS NULL",
        [recordId],
      );
      if (!existing[0]) return;
      assertVersion(existing[0], options);
      const timestamp = nowIso();
      await nativeRunSet([
        {
          statement: "UPDATE products SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?",
          values: [timestamp, timestamp, recordId],
        },
        {
          statement: "UPDATE documents SET deleted_at = ?, version = version + 1 WHERE owner_type = ? AND owner_id = ?",
          values: [timestamp, "product", recordId],
        },
      ]);
    },
  },
  documents: {
    async listForOwner(ownerType, ownerId) {
      const rows = await nativeQuery(
        "SELECT * FROM documents WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL ORDER BY uploaded_at DESC",
        [ownerType, ownerId],
      );
      return rows.map(documentDto);
    },
    async get(recordId) {
      const rows = await nativeQuery("SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL", [recordId]);
      return rows[0] ? documentDto(rows[0]) : null;
    },
    async attach(input: MobileAttachmentInput) {
      const timestamp = nowIso();
      const recordId = id("document");
      await assertDocumentOwnerExists(input.ownerType, input.ownerId);
      const storageKey = await writeProtectedStandaloneFile(input);
      try {
        await nativeRun(
          `INSERT INTO documents (
            id, owner_type, owner_id, filename, storage_key, mime_type, size, kind,
            extracted_text, uploaded_at, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            recordId,
            input.ownerType,
            input.ownerId,
            input.filename,
            storageKey,
            input.mimeType,
            input.size,
            input.kind ?? null,
            null,
            timestamp,
          ],
        );
      } catch (error) {
        await deleteProtectedStandaloneFile(storageKey);
        throw error;
      }
      return (await this.get(recordId)) as MobileDocumentDto;
    },
    async remove(recordId, options) {
      const rows = await nativeQuery<{ version: number; storage_key: string }>(
        "SELECT version, storage_key FROM documents WHERE id = ? AND deleted_at IS NULL",
        [recordId],
      );
      if (!rows[0]) return;
      assertVersion(rows[0], options);
      await nativeRun("UPDATE documents SET deleted_at = ?, version = version + 1 WHERE id = ?", [nowIso(), recordId]);
      await deleteProtectedStandaloneFile(rows[0].storage_key);
    },
  },
  modules: {
    async list() {
      const rows = await nativeQuery<{ key: ModuleKey; enabled: number; updated_at: string }>("SELECT * FROM module_settings");
      const byKey = new Map(rows.map((row) => [row.key, row]));
      return MODULE_KEYS.map((key) => ({
        key,
        enabled: Boolean(byKey.get(key)?.enabled ?? 0),
        updatedAt: byKey.get(key)?.updated_at ?? new Date(0).toISOString(),
      }));
    },
    async setEnabled(key, enabled) {
      const timestamp = nowIso();
      await nativeRun(
        `INSERT INTO module_settings (key, enabled, updated_at, version)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at, version = version + 1`,
        [key, enabled ? 1 : 0, timestamp],
      );
      return { key, enabled, updatedAt: timestamp };
    },
  },
  dashboard: {
    async getSummary(): Promise<MobileDashboardSummaryDto> {
      const [contracts, products, vehicles] = await Promise.all([
        nativeQuery("SELECT * FROM contracts WHERE deleted_at IS NULL"),
        nativeQuery("SELECT * FROM products WHERE deleted_at IS NULL"),
        nativeQuery("SELECT * FROM vehicles WHERE deleted_at IS NULL"),
      ]);
      const now = Date.now();
      const expiringBefore = now + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000;
      const activeContracts = contracts.filter((item) => item.status === "ACTIVE");
      const monthlySpend = activeContracts.reduce((sum, item) => {
        const cost = num(item.cost);
        if (!cost) return sum;
        if (item.billing_frequency === "WEEKLY") return sum + (cost * 52) / 12;
        if (item.billing_frequency === "QUARTERLY") return sum + cost / 3;
        if (item.billing_frequency === "ANNUALLY") return sum + cost / 12;
        if (item.billing_frequency === "MONTHLY") return sum + cost;
        return sum;
      }, 0);
      return {
        activeContracts: activeContracts.length,
        expiringContracts: activeContracts.filter((item) => isSoon(str(item.end_date), now, expiringBefore)).length,
        expiredContracts: activeContracts.filter((item) => isExpired(str(item.end_date), now)).length,
        productsInWarranty: products.filter((item) => {
          const warrantyEndDate = str(item.warranty_end_date);
          return Boolean(warrantyEndDate) && !isExpired(warrantyEndDate, now);
        }).length,
        productsExpiring: products.filter((item) => isSoon(str(item.warranty_end_date), now, expiringBefore)).length,
        productsExpired: products.filter((item) => isExpired(str(item.warranty_end_date), now)).length,
        vehicleCount: vehicles.length,
        upcomingVehicleExpiries: vehicles.filter(
          (item) => isSoon(str(item.rego_expiry), now, expiringBefore) || isSoon(str(item.insurance_expiry), now, expiringBefore),
        ).length,
        estimatedMonthlySpend: monthlySpend,
        currency: String(activeContracts[0]?.currency ?? products[0]?.currency ?? "AUD"),
      };
    },
  },
  vehicles: {
    async list(options) {
      const hasSearch = Boolean(options?.search?.trim());
      const rows = await nativeQuery(
        `SELECT * FROM vehicles
         WHERE deleted_at IS NULL
         ${hasSearch ? "AND (label LIKE ? OR make LIKE ? OR model LIKE ? OR license_plate LIKE ? OR vin LIKE ? OR notes LIKE ?)" : ""}
         ORDER BY updated_at DESC LIMIT ?`,
        hasSearch
          ? [like(options), like(options), like(options), like(options), like(options), like(options), limit(options)]
          : [limit(options)],
      );
      return { items: await Promise.all(rows.map(vehicleDto)), nextCursor: null };
    },
    async get(recordId) {
      const rows = await nativeQuery("SELECT * FROM vehicles WHERE id = ? AND deleted_at IS NULL", [recordId]);
      return rows[0] ? vehicleDto(rows[0]) : null;
    },
    async create(input) {
      const parsed = vehicleSchema.parse(input);
      const timestamp = nowIso();
      const recordId = id("vehicle");
      await nativeRun(
        `INSERT INTO vehicles (
          id, label, make, model, year, colour, license_plate, vin, rego_expiry,
          insurance_expiry, reminder_days_before, notes, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          recordId,
          parsed.label,
          str(parsed.make),
          str(parsed.model),
          parsed.year ?? null,
          str(parsed.colour),
          str(parsed.licensePlate),
          str(parsed.vin),
          iso(parsed.regoExpiry),
          iso(parsed.insuranceExpiry),
          str(parsed.reminderDaysBefore) ?? DEFAULT_REMINDER_DAYS,
          str(parsed.notes),
          timestamp,
          timestamp,
        ],
      );
      return (await this.get(recordId)) as MobileVehicleDto;
    },
    async update(recordId, input, options) {
      const existing = await nativeQuery<{ version: number }>(
        "SELECT version FROM vehicles WHERE id = ? AND deleted_at IS NULL",
        [recordId],
      );
      if (!existing[0]) throw new Error("Vehicle not found");
      assertVersion(existing[0], options);
      const parsed = vehicleSchema.parse(input);
      await nativeRun(
        `UPDATE vehicles SET label = ?, make = ?, model = ?, year = ?, colour = ?, license_plate = ?,
          vin = ?, rego_expiry = ?, insurance_expiry = ?, reminder_days_before = ?, notes = ?,
          updated_at = ?, version = version + 1
        WHERE id = ? AND deleted_at IS NULL`,
        [
          parsed.label,
          str(parsed.make),
          str(parsed.model),
          parsed.year ?? null,
          str(parsed.colour),
          str(parsed.licensePlate),
          str(parsed.vin),
          iso(parsed.regoExpiry),
          iso(parsed.insuranceExpiry),
          str(parsed.reminderDaysBefore) ?? DEFAULT_REMINDER_DAYS,
          str(parsed.notes),
          nowIso(),
          recordId,
        ],
      );
      return (await this.get(recordId)) as MobileVehicleDto;
    },
    async remove(recordId, options) {
      const existing = await nativeQuery<{ version: number }>(
        "SELECT version FROM vehicles WHERE id = ? AND deleted_at IS NULL",
        [recordId],
      );
      if (!existing[0]) return;
      assertVersion(existing[0], options);
      const timestamp = nowIso();
      await nativeRunSet([
        {
          statement: "UPDATE vehicles SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?",
          values: [timestamp, timestamp, recordId],
        },
        {
          statement: "UPDATE vehicle_items SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE vehicle_id = ?",
          values: [timestamp, timestamp, recordId],
        },
      ]);
    },
    async listItems(vehicleId) {
      const rows = await nativeQuery(
        "SELECT * FROM vehicle_items WHERE vehicle_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC",
        [vehicleId],
      );
      return Promise.all(rows.map(vehicleItemDto));
    },
    async createItem(vehicleId, input) {
      const parsed = vehicleItemSchema.parse(input);
      const vehicle = await this.get(vehicleId);
      if (!vehicle) throw new Error("Vehicle not found");
      const timestamp = nowIso();
      const recordId = id("vehicle_item");
      await nativeRun(
        `INSERT INTO vehicle_items (
          id, vehicle_id, type, title, provider, date, cost, currency, notes, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          recordId,
          vehicleId,
          parsed.type,
          parsed.title,
          str(parsed.provider),
          iso(parsed.date),
          parsed.cost ?? null,
          parsed.currency,
          str(parsed.notes),
          timestamp,
          timestamp,
        ],
      );
      const rows = await nativeQuery("SELECT * FROM vehicle_items WHERE id = ?", [recordId]);
      return vehicleItemDto(rows[0]);
    },
    async updateItem(vehicleId, itemId, input, options) {
      const existing = await nativeQuery<{ version: number }>(
        "SELECT version FROM vehicle_items WHERE id = ? AND vehicle_id = ? AND deleted_at IS NULL",
        [itemId, vehicleId],
      );
      if (!existing[0]) throw new Error("Vehicle item not found");
      assertVersion(existing[0], options);
      const parsed = vehicleItemSchema.parse(input);
      await nativeRun(
        `UPDATE vehicle_items SET type = ?, title = ?, provider = ?, date = ?, cost = ?, currency = ?,
          notes = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND vehicle_id = ? AND deleted_at IS NULL`,
        [
          parsed.type,
          parsed.title,
          str(parsed.provider),
          iso(parsed.date),
          parsed.cost ?? null,
          parsed.currency,
          str(parsed.notes),
          nowIso(),
          itemId,
          vehicleId,
        ],
      );
      const rows = await nativeQuery("SELECT * FROM vehicle_items WHERE id = ?", [itemId]);
      return vehicleItemDto(rows[0]);
    },
    async removeItem(vehicleId, itemId, options) {
      const existing = await nativeQuery<{ version: number }>(
        "SELECT version FROM vehicle_items WHERE id = ? AND vehicle_id = ? AND deleted_at IS NULL",
        [itemId, vehicleId],
      );
      if (!existing[0]) return;
      assertVersion(existing[0], options);
      const timestamp = nowIso();
      await nativeRunSet([
        {
          statement: "UPDATE vehicle_items SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?",
          values: [timestamp, timestamp, itemId],
        },
        {
          statement: "UPDATE documents SET deleted_at = ?, version = version + 1 WHERE owner_type = ? AND owner_id = ?",
          values: [timestamp, "vehicleItem", itemId],
        },
      ]);
    },
  },
};

function isSoon(value: string | null, now: number, expiringBefore: number): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return time >= now && time <= expiringBefore;
}

function isExpired(value: string | null, now: number): boolean {
  return Boolean(value && new Date(value).getTime() < now);
}
