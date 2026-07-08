import { z } from "zod";

export const TRIP_SEGMENT_TYPES = ["FLIGHT", "LODGING", "ACTIVITY"] as const;

const emptyToUndefined = (val: unknown) =>
  val == null || (typeof val === "string" && val.trim() === "") ? undefined : val;

export const tripSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    destination: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
    startDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
    endDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
    notes: z.preprocess(emptyToUndefined, z.string().trim().max(5000).optional()),
  })
  .refine((data) => !data.startDate || !data.endDate || data.endDate >= data.startDate, {
    message: "End date can't be before the start date.",
    path: ["endDate"],
  });

export type TripInput = z.infer<typeof tripSchema>;

export const tripSegmentSchema = z
  .object({
    type: z.enum(TRIP_SEGMENT_TYPES),
    title: z.string().trim().min(1, "Title is required").max(200),
    provider: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
    confirmationCode: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
    startDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
    endDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
    location: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
    cost: z.preprocess(emptyToUndefined, z.coerce.number().min(0).optional()),
    currency: z.string().trim().min(1).max(10).default("AUD"),
    notes: z.preprocess(emptyToUndefined, z.string().trim().max(5000).optional()),
    // Flight-specific (only meaningful when type=FLIGHT)
    flightNumber: z.preprocess(emptyToUndefined, z.string().trim().toUpperCase().max(10).optional()),
    departureIata: z.preprocess(emptyToUndefined, z.string().trim().toUpperCase().max(4).optional()),
    arrivalIata: z.preprocess(emptyToUndefined, z.string().trim().toUpperCase().max(4).optional()),
  })
  .refine((data) => !data.startDate || !data.endDate || data.endDate >= data.startDate, {
    message: "End date can't be before the start date.",
    path: ["endDate"],
  });

export type TripSegmentInput = z.infer<typeof tripSegmentSchema>;
