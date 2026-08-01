import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ModuleKey } from "@/lib/modules/registry";
import type {
  BillingFrequency,
  ContractCategory,
  ContractStatus,
  ISODateString,
  MobileDocumentOwnerType,
  ProductDocumentKind,
  RenewalType,
  VehicleItemType,
} from "@/lib/mobile/dtos";

export const STANDALONE_DB_NAME = "hearth-standalone";
export const STANDALONE_DB_VERSION = 1;

export interface StandaloneProfileRecord {
  id: string;
  displayName: string | null;
  defaultCurrency: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  version: number;
}

export interface StandaloneModuleRecord {
  key: ModuleKey;
  enabled: boolean;
  updatedAt: ISODateString;
  version: number;
}

export interface StandaloneContractRecord {
  id: string;
  title: string;
  category: ContractCategory;
  provider: string;
  contractNumber: string | null;
  startDate: ISODateString | null;
  endDate: ISODateString | null;
  renewalType: RenewalType;
  noticePeriodDays: number | null;
  cost: number | null;
  currency: string;
  billingFrequency: BillingFrequency | null;
  status: ContractStatus;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  notes: string | null;
  reminderDaysBefore: string | null;
  isTaxDeductible: boolean;
  propertyId: string | null;
  vehicleId: string | null;
  deletedAt: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  version: number;
}

export interface StandaloneProductRecord {
  id: string;
  description: string;
  manufacturer: string | null;
  model: string | null;
  vendor: string | null;
  serialNumber: string | null;
  barcode: string | null;
  purchaseDate: ISODateString | null;
  warrantyEndDate: ISODateString | null;
  price: number | null;
  currency: string;
  notes: string | null;
  reminderDaysBefore: string | null;
  propertyId: string | null;
  deletedAt: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  version: number;
}

export interface StandaloneVehicleRecord {
  id: string;
  label: string;
  make: string | null;
  model: string | null;
  year: number | null;
  colour: string | null;
  licensePlate: string | null;
  vin: string | null;
  regoExpiry: ISODateString | null;
  insuranceExpiry: ISODateString | null;
  reminderDaysBefore: string | null;
  notes: string | null;
  deletedAt: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  version: number;
}

export interface StandaloneVehicleItemRecord {
  id: string;
  vehicleId: string;
  type: VehicleItemType;
  title: string;
  provider: string | null;
  date: ISODateString | null;
  cost: number | null;
  currency: string;
  notes: string | null;
  deletedAt: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  version: number;
}

export interface StandaloneDocumentRecord {
  id: string;
  ownerType: MobileDocumentOwnerType;
  ownerId: string;
  filename: string;
  storageKey: string;
  mimeType: string;
  size: number;
  kind: ProductDocumentKind | null;
  extractedText: string | null;
  uploadedAt: ISODateString;
  deletedAt: ISODateString | null;
  version: number;
  blob?: Blob;
  fileUri?: string;
}

interface StandaloneSchema extends DBSchema {
  profile: {
    key: string;
    value: StandaloneProfileRecord;
  };
  modules: {
    key: ModuleKey;
    value: StandaloneModuleRecord;
  };
  contracts: {
    key: string;
    value: StandaloneContractRecord;
    indexes: {
      "by-updated": ISODateString;
    };
  };
  products: {
    key: string;
    value: StandaloneProductRecord;
    indexes: {
      "by-updated": ISODateString;
    };
  };
  vehicles: {
    key: string;
    value: StandaloneVehicleRecord;
    indexes: {
      "by-updated": ISODateString;
    };
  };
  vehicleItems: {
    key: string;
    value: StandaloneVehicleItemRecord;
    indexes: {
      "by-vehicle": string;
      "by-updated": ISODateString;
    };
  };
  documents: {
    key: string;
    value: StandaloneDocumentRecord;
    indexes: {
      "by-owner": [MobileDocumentOwnerType, string];
      "by-storage-key": string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<StandaloneSchema>> | null = null;

export function getStandaloneDb(): Promise<IDBPDatabase<StandaloneSchema>> {
  dbPromise ??= openDB<StandaloneSchema>(
    STANDALONE_DB_NAME,
    STANDALONE_DB_VERSION,
    {
      upgrade(db) {
        db.createObjectStore("profile", { keyPath: "id" });
        db.createObjectStore("modules", { keyPath: "key" });

        const contracts = db.createObjectStore("contracts", { keyPath: "id" });
        contracts.createIndex("by-updated", "updatedAt");

        const products = db.createObjectStore("products", { keyPath: "id" });
        products.createIndex("by-updated", "updatedAt");

        const vehicles = db.createObjectStore("vehicles", { keyPath: "id" });
        vehicles.createIndex("by-updated", "updatedAt");

        const vehicleItems = db.createObjectStore("vehicleItems", {
          keyPath: "id",
        });
        vehicleItems.createIndex("by-vehicle", "vehicleId");
        vehicleItems.createIndex("by-updated", "updatedAt");

        const documents = db.createObjectStore("documents", { keyPath: "id" });
        documents.createIndex("by-owner", ["ownerType", "ownerId"]);
        documents.createIndex("by-storage-key", "storageKey", { unique: true });
      },
    },
  );
  return dbPromise;
}

export function nowIso(): ISODateString {
  return new Date().toISOString();
}

export function createStandaloneId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
