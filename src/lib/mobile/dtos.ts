import type { ModuleKey } from "@/lib/modules/registry";
import type { ContractInput } from "@/lib/validation/contract";
import {
  BILLING_FREQUENCIES,
  CONTRACT_CATEGORIES,
  CONTRACT_STATUSES,
  RENEWAL_TYPES,
} from "@/lib/validation/contract";
import type { ProductInput } from "@/lib/validation/product";
import type { VehicleInput, VehicleItemInput } from "@/lib/validation/vehicles";
import { VEHICLE_ITEM_TYPES } from "@/lib/validation/vehicles";

export type ISODateString = string;
export type MobileRecordId = string;
export type MobileVersion = number | string;

export type ContractCategory = (typeof CONTRACT_CATEGORIES)[number];
export type RenewalType = (typeof RENEWAL_TYPES)[number];
export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number];
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
export type VehicleItemType = (typeof VEHICLE_ITEM_TYPES)[number];

export type ProductDocumentKind =
  | "INVOICE"
  | "PHOTO"
  | "MANUAL"
  | "RECEIPT"
  | "OTHER";

export type MobileDocumentOwnerType =
  | "contract"
  | "product"
  | "vehicleItem"
  | "tripSegment"
  | "homeItem"
  | "inventoryItem"
  | "trade"
  | "rentalStatement";

export interface MobileRecordMeta {
  id: MobileRecordId;
  version: MobileVersion;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type MobileContractInput = Omit<
  ContractInput,
  "startDate" | "endDate"
> & {
  startDate?: ISODateString | null;
  endDate?: ISODateString | null;
};

export interface MobileContractDto extends MobileRecordMeta {
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
  propertyId: MobileRecordId | null;
  vehicleId: MobileRecordId | null;
  documentCount: number;
}

export type MobileProductInput = Omit<
  ProductInput,
  "purchaseDate" | "warrantyEndDate"
> & {
  purchaseDate?: ISODateString | null;
  warrantyEndDate?: ISODateString | null;
};

export interface MobileProductDto extends MobileRecordMeta {
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
  propertyId: MobileRecordId | null;
  documentCount: number;
}

export type MobileVehicleInput = Omit<
  VehicleInput,
  "regoExpiry" | "insuranceExpiry"
> & {
  regoExpiry?: ISODateString | null;
  insuranceExpiry?: ISODateString | null;
};

export interface MobileVehicleDto extends MobileRecordMeta {
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
  itemCount: number;
}

export type MobileVehicleItemInput = Omit<VehicleItemInput, "date"> & {
  date?: ISODateString | null;
};

export interface MobileVehicleItemDto extends MobileRecordMeta {
  vehicleId: MobileRecordId;
  type: VehicleItemType;
  title: string;
  provider: string | null;
  date: ISODateString | null;
  cost: number | null;
  currency: string;
  notes: string | null;
  documentCount: number;
}

export interface MobileDocumentDto {
  id: MobileRecordId;
  ownerType: MobileDocumentOwnerType;
  ownerId: MobileRecordId;
  filename: string;
  storageKey: string;
  mimeType: string;
  size: number;
  kind: ProductDocumentKind | null;
  extractedText: string | null;
  uploadedAt: ISODateString;
  version: MobileVersion;
}

export interface MobileModuleSettingDto {
  key: ModuleKey;
  enabled: boolean;
  updatedAt: ISODateString;
}

export interface MobileDashboardSummaryDto {
  activeContracts: number;
  expiringContracts: number;
  expiredContracts: number;
  productsInWarranty: number;
  productsExpiring: number;
  productsExpired: number;
  vehicleCount: number;
  upcomingVehicleExpiries: number;
  estimatedMonthlySpend: number;
  currency: string;
}

export interface MobileServerCompatibilityDto {
  serverInstanceId: string;
  product: "hearth";
  apiVersion: "mobile-v1";
  minAppVersion: string | null;
  capabilities: string[];
}
