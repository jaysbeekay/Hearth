import { z } from "zod";

export const CONTRACT_CATEGORIES = [
  "RENTAL",
  "CAR_INSURANCE",
  "HOME_INSURANCE",
  "STRATA_INSURANCE",
  "HEALTH_INSURANCE",
  "LIFE_INSURANCE",
  "UTILITY",
  "TELECOM",
  "SUBSCRIPTION",
  "LOAN",
  "WARRANTY",
  "OTHER",
] as const;

export const RENEWAL_TYPES = ["AUTO_RENEW", "MANUAL_RENEWAL", "FIXED_TERM"] as const;

export const BILLING_FREQUENCIES = [
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "ANNUALLY",
  "ONE_OFF",
] as const;

export const CONTRACT_STATUSES = ["ACTIVE", "CANCELLED"] as const;

const emptyToUndefined = (val: unknown) =>
  typeof val === "string" && val.trim() === "" ? undefined : val;

export const contractSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  category: z.enum(CONTRACT_CATEGORIES),
  provider: z.string().trim().min(1, "Provider/company is required").max(200),
  contractNumber: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  startDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  endDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  renewalType: z.enum(RENEWAL_TYPES),
  noticePeriodDays: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(3650).optional(),
  ),
  cost: z.preprocess(emptyToUndefined, z.coerce.number().min(0).optional()),
  currency: z.string().trim().min(1).max(10).default("AUD"),
  billingFrequency: z.preprocess(
    emptyToUndefined,
    z.enum(BILLING_FREQUENCIES).optional(),
  ),
  status: z.enum(CONTRACT_STATUSES).default("ACTIVE"),
  contactName: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  contactPhone: z.preprocess(emptyToUndefined, z.string().trim().max(50).optional()),
  contactEmail: z.preprocess(
    emptyToUndefined,
    z.string().trim().email().max(200).optional(),
  ),
  notes: z.preprocess(emptyToUndefined, z.string().trim().max(5000).optional()),
  reminderDaysBefore: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .max(100)
      .refine(
        (val) =>
          val.split(",").every((part) => {
            const n = Number(part.trim());
            return part.trim() !== "" && Number.isFinite(n) && n >= 0;
          }),
        "Use a comma-separated list of non-negative numbers, e.g. 30,14,7,1",
      )
      .optional(),
  ),
  isTaxDeductible: z.boolean().default(false),
}).refine(
  (data) => !data.startDate || !data.endDate || data.endDate >= data.startDate,
  { message: "End date can't be before the start date.", path: ["endDate"] },
);

export type ContractInput = z.infer<typeof contractSchema>;
