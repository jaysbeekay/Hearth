import { z } from "zod";

/** #354 — a Snooze request: a preset number of days, or a chosen day it comes back. */
export const snoozeSchema = z
  .object({
    kind: z.enum(["contract", "warranty", "vehicle"]),
    id: z.string().min(1),
    days: z.coerce.number().int().min(1).max(366).optional(),
    until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.")
      .optional(),
  })
  .refine((v) => v.days != null || v.until != null, { message: "Choose how long to snooze for." });

export const unsnoozeSchema = z.object({
  kind: z.enum(["contract", "warranty", "vehicle"]),
  id: z.string().min(1),
});
