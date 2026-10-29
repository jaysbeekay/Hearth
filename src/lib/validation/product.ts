import { z } from "zod";
import { reminderDaysBeforeField } from "@/lib/validation/reminderThresholds";

const emptyToUndefined = (val: unknown) =>
  val == null || (typeof val === "string" && val.trim() === "") ? undefined : val;

// The unrefined object: see contractBaseSchema.
export const productBaseSchema = z.object({
  description: z.string().trim().min(1, "Description is required").max(200),
  manufacturer: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  model: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  vendor: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  serialNumber: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  barcode: z.preprocess(emptyToUndefined, z.string().trim().max(64).optional()),
  purchaseDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  warrantyEndDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  price: z.preprocess(emptyToUndefined, z.coerce.number().min(0).optional()),
  currency: z.string().trim().min(1).max(10).default("AUD"),
  notes: z.preprocess(emptyToUndefined, z.string().trim().max(5000).optional()),
  reminderDaysBefore: reminderDaysBeforeField,
  propertyId: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
});

const productDatesInOrder = (data: { purchaseDate?: Date; warrantyEndDate?: Date }) =>
  !data.purchaseDate || !data.warrantyEndDate || data.warrantyEndDate >= data.purchaseDate;
const productDateOrderIssue = {
  message: "Warranty end date can't be before the purchase date.",
  path: ["warrantyEndDate"],
};

export const productSchema = productBaseSchema.refine(productDatesInOrder, productDateOrderIssue);

// A partial update: see contractPatchSchema.
export const productPatchSchema = productBaseSchema.partial().refine(productDatesInOrder, productDateOrderIssue);

export type ProductInput = z.infer<typeof productSchema>;
