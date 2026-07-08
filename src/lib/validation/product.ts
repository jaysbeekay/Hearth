import { z } from "zod";

const emptyToUndefined = (val: unknown) =>
  val == null || (typeof val === "string" && val.trim() === "") ? undefined : val;

export const productSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(200),
  manufacturer: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  vendor: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  serialNumber: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  barcode: z.preprocess(emptyToUndefined, z.string().trim().max(64).optional()),
  purchaseDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  warrantyEndDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  price: z.preprocess(emptyToUndefined, z.coerce.number().min(0).optional()),
  currency: z.string().trim().min(1).max(10).default("AUD"),
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
}).refine(
  (data) => !data.purchaseDate || !data.warrantyEndDate || data.warrantyEndDate >= data.purchaseDate,
  { message: "Warranty end date can't be before the purchase date.", path: ["warrantyEndDate"] },
);

export type ProductInput = z.infer<typeof productSchema>;
