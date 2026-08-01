import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ModuleKey } from "@/lib/modules/registry";
import { MODULE_KEYS } from "@/lib/modules/registry";
import type {
  MobileContractDto,
  MobileDashboardSummaryDto,
  MobileDocumentDto,
  MobileDocumentOwnerType,
  MobileModuleSettingDto,
  MobileProductDto,
  MobileVehicleDto,
  MobileVehicleItemDto,
} from "@/lib/mobile/dtos";

export type MobileSessionUser = NonNullable<Session["user"]>;

const EXPIRING_SOON_DAYS = 30;

export function mobileError(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function requireMobileUser(
  options: { write?: boolean; admin?: boolean } = {},
) {
  const session = await auth();
  if (!session?.user)
    return { response: mobileError("Unauthorized", 401) } as const;
  if (options.admin && session.user.role !== "ADMIN") {
    return {
      response: mobileError("Only admins can perform this action.", 403),
    } as const;
  }
  if (options.write && session.user.role === "READONLY") {
    return {
      response: mobileError("Your account has read-only access.", 403),
    } as const;
  }
  return { user: session.user } as const;
}

export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

export function mapContract(row: {
  id: string;
  title: string;
  category: string;
  provider: string;
  contractNumber: string | null;
  startDate: Date | null;
  endDate: Date | null;
  renewalType: string;
  noticePeriodDays: number | null;
  cost: number | null;
  currency: string;
  billingFrequency: string | null;
  status: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  notes: string | null;
  reminderDaysBefore: string | null;
  isTaxDeductible: boolean;
  propertyId: string | null;
  vehicleId: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { documents: number };
}): MobileContractDto {
  return {
    id: row.id,
    version: row.updatedAt.toISOString(),
    title: row.title,
    category: row.category as MobileContractDto["category"],
    provider: row.provider,
    contractNumber: row.contractNumber,
    startDate: iso(row.startDate),
    endDate: iso(row.endDate),
    renewalType: row.renewalType as MobileContractDto["renewalType"],
    noticePeriodDays: row.noticePeriodDays,
    cost: row.cost,
    currency: row.currency,
    billingFrequency:
      row.billingFrequency as MobileContractDto["billingFrequency"],
    status: row.status as MobileContractDto["status"],
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    notes: row.notes,
    reminderDaysBefore: row.reminderDaysBefore,
    isTaxDeductible: row.isTaxDeductible,
    propertyId: row.propertyId,
    vehicleId: row.vehicleId,
    documentCount: row._count?.documents ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapProduct(row: {
  id: string;
  description: string;
  manufacturer: string | null;
  model: string | null;
  vendor: string | null;
  serialNumber: string | null;
  barcode: string | null;
  purchaseDate: Date | null;
  warrantyEndDate: Date | null;
  price: number | null;
  currency: string;
  notes: string | null;
  reminderDaysBefore: string | null;
  propertyId: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { documents: number };
}): MobileProductDto {
  return {
    id: row.id,
    version: row.updatedAt.toISOString(),
    description: row.description,
    manufacturer: row.manufacturer,
    model: row.model,
    vendor: row.vendor,
    serialNumber: row.serialNumber,
    barcode: row.barcode,
    purchaseDate: iso(row.purchaseDate),
    warrantyEndDate: iso(row.warrantyEndDate),
    price: row.price,
    currency: row.currency,
    notes: row.notes,
    reminderDaysBefore: row.reminderDaysBefore,
    propertyId: row.propertyId,
    documentCount: row._count?.documents ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapVehicle(row: {
  id: string;
  label: string;
  make: string | null;
  model: string | null;
  year: number | null;
  colour: string | null;
  licensePlate: string | null;
  vin: string | null;
  regoExpiry: Date | null;
  insuranceExpiry: Date | null;
  reminderDaysBefore: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { items: number };
}): MobileVehicleDto {
  return {
    id: row.id,
    version: row.updatedAt.toISOString(),
    label: row.label,
    make: row.make,
    model: row.model,
    year: row.year,
    colour: row.colour,
    licensePlate: row.licensePlate,
    vin: row.vin,
    regoExpiry: iso(row.regoExpiry),
    insuranceExpiry: iso(row.insuranceExpiry),
    reminderDaysBefore: row.reminderDaysBefore,
    notes: row.notes,
    itemCount: row._count?.items ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapVehicleItem(row: {
  id: string;
  vehicleId: string;
  type: string;
  title: string;
  provider: string | null;
  date: Date | null;
  cost: number | null;
  currency: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { documents: number };
}): MobileVehicleItemDto {
  return {
    id: row.id,
    version: row.updatedAt.toISOString(),
    vehicleId: row.vehicleId,
    type: row.type as MobileVehicleItemDto["type"],
    title: row.title,
    provider: row.provider,
    date: iso(row.date),
    cost: row.cost,
    currency: row.currency,
    notes: row.notes,
    documentCount: row._count?.documents ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapDocument(
  ownerType: MobileDocumentOwnerType,
  row: {
    id: string;
    filename: string;
    storedName: string;
    mimeType: string;
    size: number;
    extractedText?: string | null;
    uploadedAt: Date;
    kind?: string | null;
  },
  ownerId: string,
): MobileDocumentDto {
  return {
    id: row.id,
    ownerType,
    ownerId,
    filename: row.filename,
    storageKey: row.storedName,
    mimeType: row.mimeType,
    size: row.size,
    kind: row.kind as MobileDocumentDto["kind"],
    extractedText: row.extractedText ?? null,
    uploadedAt: row.uploadedAt.toISOString(),
    version: row.uploadedAt.toISOString(),
  };
}

export async function getModuleSettings(): Promise<MobileModuleSettingDto[]> {
  const rows = await prisma.moduleEnablement.findMany();
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return MODULE_KEYS.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      enabled: row?.enabled ?? false,
      updatedAt: row?.updatedAt.toISOString() ?? new Date(0).toISOString(),
    };
  });
}

export function parseModuleKey(value: string): ModuleKey | null {
  return (MODULE_KEYS as readonly string[]).includes(value)
    ? (value as ModuleKey)
    : null;
}

export async function buildDashboardSummary(): Promise<MobileDashboardSummaryDto> {
  const [contracts, products, vehicles] = await Promise.all([
    prisma.contract.findMany(),
    prisma.product.findMany(),
    prisma.vehicle.findMany(),
  ]);
  const now = Date.now();
  const expiringBefore = now + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000;
  const activeContracts = contracts.filter((item) => item.status === "ACTIVE");
  const monthlySpend = activeContracts.reduce((sum, item) => {
    if (!item.cost) return sum;
    if (item.billingFrequency === "WEEKLY") return sum + (item.cost * 52) / 12;
    if (item.billingFrequency === "QUARTERLY") return sum + item.cost / 3;
    if (item.billingFrequency === "ANNUALLY") return sum + item.cost / 12;
    if (item.billingFrequency === "MONTHLY") return sum + item.cost;
    return sum;
  }, 0);

  return {
    activeContracts: activeContracts.length,
    expiringContracts: activeContracts.filter((item) => {
      if (!item.endDate) return false;
      const time = item.endDate.getTime();
      return time >= now && time <= expiringBefore;
    }).length,
    expiredContracts: activeContracts.filter(
      (item) => item.endDate && item.endDate.getTime() < now,
    ).length,
    productsInWarranty: products.filter(
      (item) => item.warrantyEndDate && item.warrantyEndDate.getTime() >= now,
    ).length,
    productsExpiring: products.filter((item) => {
      if (!item.warrantyEndDate) return false;
      const time = item.warrantyEndDate.getTime();
      return time >= now && time <= expiringBefore;
    }).length,
    productsExpired: products.filter(
      (item) => item.warrantyEndDate && item.warrantyEndDate.getTime() < now,
    ).length,
    vehicleCount: vehicles.length,
    upcomingVehicleExpiries: vehicles.filter((item) =>
      [item.regoExpiry, item.insuranceExpiry].some((date) => {
        if (!date) return false;
        const time = date.getTime();
        return time >= now && time <= expiringBefore;
      }),
    ).length,
    estimatedMonthlySpend: monthlySpend,
    currency: activeContracts[0]?.currency ?? products[0]?.currency ?? "AUD",
  };
}
