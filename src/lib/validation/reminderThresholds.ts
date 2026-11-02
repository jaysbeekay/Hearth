import { z } from "zod";

const emptyToUndefined = (val: unknown) =>
  val == null || (typeof val === "string" && val.trim() === "") ? undefined : val;

/**
 * A record's Reminder thresholds as typed: a comma-separated list of days
 * before its date ("30,14,7,1"). Blank means none of its own, so the
 * household default applies. Shared by Contracts, Warranties, Vehicles and
 * Tenancies.
 */
export const reminderDaysBeforeField = z.preprocess(
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
);
