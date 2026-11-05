// #456 review - when a Contract stops Covering a Vehicle date (cancelled,
// unlinked, re-categorised, or its end date removed), the Vehicle's own
// manual date applies again. That date may be stale or already past, so the
// Contract page says so and links to the Vehicle's edit form.

import { prisma } from "@/lib/prisma";
import { COVERING_CONTRACTS, coveredDateMessage, coveredFieldOf, resumedDateMessage, vehicleCovers } from "@/lib/covers";
import { getHouseholdToday } from "@/lib/appSettings";
import { getUserPreferences } from "@/lib/userPreferences";
import { formatDate } from "@/lib/utils";

export type ResumableField = "regoExpiry" | "insuranceExpiry";

/** Parses the `?resumed=<vehicleId>:<field>` a redirect after an edit carries. */
export function parseResumed(value: string | undefined): { vehicleId: string; field: ResumableField } | null {
  if (!value) return null;
  const [vehicleId, field] = value.split(":");
  if (!vehicleId || (field !== "regoExpiry" && field !== "insuranceExpiry")) return null;
  return { vehicleId, field };
}

/** The dates a Vehicle's Contracts Cover right now. */
async function coveredFields(vehicleId: string): Promise<Set<ResumableField>> {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { contracts: COVERING_CONTRACTS },
  });
  return new Set(vehicleCovers(vehicle?.contracts ?? []).map((c) => c.field));
}

/** Before an edit: which Vehicle the Contract is linked to and what its Contracts Cover. */
export async function coverSnapshot(contractId: string) {
  const contract = await prisma.contract.findUnique({ where: { id: contractId }, select: { vehicleId: true } });
  const vehicleId = contract?.vehicleId ?? null;
  return { vehicleId, fields: vehicleId ? await coveredFields(vehicleId) : new Set<ResumableField>() };
}

/** Before a save that may link a Vehicle: what that Vehicle's Contracts Cover now. */
export async function vehicleCoverSnapshot(vehicleId: string | null | undefined) {
  const id = vehicleId ?? null;
  return { vehicleId: id, fields: id ? await coveredFields(id) : new Set<ResumableField>() };
}

/**
 * After a save (#487 review): the first date this Contract now Covers that no
 * Contract Covered before, as a `?covered=` value, or null.
 */
export async function gainedCover(
  before: Awaited<ReturnType<typeof vehicleCoverSnapshot>>,
  contractId: string,
): Promise<string | null> {
  if (!before.vehicleId) return null;
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: before.vehicleId },
    select: { contracts: COVERING_CONTRACTS },
  });
  const gained = vehicleCovers(vehicle?.contracts ?? []).find(
    (c) => c.contract.id === contractId && !before.fields.has(c.field),
  );
  return gained ? `${before.vehicleId}:${gained.field}` : null;
}

/**
 * The notice for a Vehicle date this Contract now Covers in place of a
 * different date of the Vehicle's own, or null when there's nothing to say
 * (it no longer Covers it, the dates match, or the Vehicle had none).
 */
export async function coveredNotice(contractId: string, vehicleId: string, field: ResumableField) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { id: true, label: true, deletedAt: true, regoExpiry: true, insuranceExpiry: true, contracts: COVERING_CONTRACTS },
  });
  if (!vehicle || vehicle.deletedAt) return null;
  const cover = vehicleCovers(vehicle.contracts).find((c) => c.field === field && c.contract.id === contractId);
  if (!cover) return null;
  const { dateFormat } = await getUserPreferences();
  const manual = field === "regoExpiry" ? vehicle.regoExpiry : vehicle.insuranceExpiry;
  const message = coveredDateMessage(
    field,
    manual,
    cover.date,
    manual ? formatDate(manual, dateFormat) : null,
    formatDate(cover.date, dateFormat),
  );
  return message ? { vehicleId: vehicle.id, label: vehicle.label, message } : null;
}

/** After an edit: the first date the Vehicle stopped having a cover for, as a `?resumed=` value. */
export async function lostCover(before: Awaited<ReturnType<typeof coverSnapshot>>): Promise<string | null> {
  if (!before.vehicleId || before.fields.size === 0) return null;
  const now = await coveredFields(before.vehicleId);
  for (const field of before.fields) {
    if (!now.has(field)) return `${before.vehicleId}:${field}`;
  }
  return null;
}

/**
 * The notice for a Vehicle date no Contract Covers now, or null when it is
 * still Covered (or the Vehicle is gone).
 */
export async function resumedNotice(vehicleId: string, field: ResumableField) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { id: true, label: true, deletedAt: true, regoExpiry: true, insuranceExpiry: true, contracts: COVERING_CONTRACTS },
  });
  if (!vehicle || vehicle.deletedAt) return null;
  if (vehicleCovers(vehicle.contracts).some((c) => c.field === field)) return null;
  const [today, { dateFormat }] = await Promise.all([getHouseholdToday(), getUserPreferences()]);
  const manual = vehicle[field];
  return {
    vehicleId: vehicle.id,
    label: vehicle.label,
    message: resumedDateMessage(field, manual, today, manual ? formatDate(manual, dateFormat) : null),
  };
}

/** The date a Contract in a Covering Category would Cover, for a Cancelled one's notice. */
export function coverFieldFor(category: string): ResumableField | null {
  return coveredFieldOf(category);
}
