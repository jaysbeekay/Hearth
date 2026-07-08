import { z } from "zod";

export const HOME_ITEM_TYPES = ["MAINTENANCE", "IMPROVEMENT", "REPAIR", "OTHER"] as const;

const emptyToUndefined = (val: unknown) =>
  val == null || (typeof val === "string" && val.trim() === "") ? undefined : val;

export const propertySchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(200),
  address: z.preprocess(emptyToUndefined, z.string().trim().max(300).optional()),
  notes: z.preprocess(emptyToUndefined, z.string().trim().max(5000).optional()),
});

export type PropertyInput = z.infer<typeof propertySchema>;

export const homeItemSchema = z.object({
  type: z.enum(HOME_ITEM_TYPES),
  title: z.string().trim().min(1, "Title is required").max(200),
  provider: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  date: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  cost: z.preprocess(emptyToUndefined, z.coerce.number().min(0).optional()),
  currency: z.string().trim().min(1).max(10).default("AUD"),
  isTaxDeductible: z.boolean().default(false),
  notes: z.preprocess(emptyToUndefined, z.string().trim().max(5000).optional()),
});

export type HomeItemInput = z.infer<typeof homeItemSchema>;

export const rentalAgreementSchema = z.object({
  tenantName: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  weeklyRent: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(0, "Weekly rent must be positive"),
  ),
  managementFeePercent: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(0).max(100).optional(),
  ),
  leaseStart: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  leaseEnd: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  bondAmount: z.preprocess(emptyToUndefined, z.coerce.number().min(0).optional()),
  currency: z.string().trim().min(1).max(10).default("AUD"),
  notes: z.preprocess(emptyToUndefined, z.string().trim().max(5000).optional()),
});

export type RentalAgreementInput = z.infer<typeof rentalAgreementSchema>;

export const rentalStatementSchema = z.object({
  periodStart: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  periodEnd: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  statementDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  grossRent: z.preprocess(emptyToUndefined, z.coerce.number().min(0).optional()),
  managementFee: z.preprocess(emptyToUndefined, z.coerce.number().min(0).optional()),
  otherDeductions: z.preprocess(emptyToUndefined, z.coerce.number().min(0).optional()),
  netAmount: z.preprocess(emptyToUndefined, z.coerce.number().optional()),
  currency: z.string().trim().min(1).max(10).default("AUD"),
  notes: z.preprocess(emptyToUndefined, z.string().trim().max(5000).optional()),
});

export type RentalStatementInput = z.infer<typeof rentalStatementSchema>;
