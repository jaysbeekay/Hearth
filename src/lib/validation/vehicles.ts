import { z } from "zod";

export const VEHICLE_ITEM_TYPES = [
  "SERVICE",
  "REPAIR",
  "REGISTRATION",
  "INSURANCE",
  "ROADWORTHY",
  "MODIFICATION",
  "OTHER",
] as const;

const emptyToUndefined = (val: unknown) =>
  typeof val === "string" && val.trim() === "" ? undefined : val;

export const vehicleSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(200),
  make: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  model: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  year: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1886).max(2100).optional()),
  colour: z.preprocess(emptyToUndefined, z.string().trim().max(50).optional()),
  licensePlate: z.preprocess(emptyToUndefined, z.string().trim().max(20).optional()),
  vin: z.preprocess(emptyToUndefined, z.string().trim().max(50).optional()),
  regoExpiry: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  insuranceExpiry: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  reminderDaysBefore: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  notes: z.preprocess(emptyToUndefined, z.string().trim().max(5000).optional()),
});

export type VehicleInput = z.infer<typeof vehicleSchema>;

export const vehicleItemSchema = z.object({
  type: z.enum(VEHICLE_ITEM_TYPES),
  title: z.string().trim().min(1, "Title is required").max(200),
  provider: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  date: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  cost: z.preprocess(emptyToUndefined, z.coerce.number().min(0).optional()),
  currency: z.string().trim().min(1).max(10).default("AUD"),
  notes: z.preprocess(emptyToUndefined, z.string().trim().max(5000).optional()),
});

export type VehicleItemInput = z.infer<typeof vehicleItemSchema>;
