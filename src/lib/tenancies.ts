// #388 — the Tenancies whose lease end can carry Reminders: each rented
// Property's current Tenancy (currentTenancy in dueRecords.ts), the same
// ones whose lease end is Due on the dashboard, Upcoming and iCal. Older
// agreements are history, so their lease ends never remind. Shared by the
// scheduler and the household Reminder roll-up so they agree on the set.

import { prisma } from "@/lib/prisma";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { currentTenancy, TENANCY_AGREEMENT_SELECT } from "@/lib/dueRecords";
import type { Prisma } from "@/generated/prisma/client";

export interface CurrentTenancy {
  propertyId: string;
  propertyLabel: string;
  tenancy: Prisma.RentalAgreementGetPayload<{ select: typeof TENANCY_AGREEMENT_SELECT }>;
}

const RENTED_PROPERTY_SELECT = {
  id: true,
  label: true,
  isRented: true,
  rentalAgreements: { select: TENANCY_AGREEMENT_SELECT },
} as const;

async function currentTenanciesWhere(where: Prisma.PropertyWhereInput): Promise<CurrentTenancy[]> {
  if (!(await isModuleEnabled("HOME"))) return [];
  const properties = await prisma.property.findMany({
    where: { ...where, deletedAt: null, isRented: true },
    select: RENTED_PROPERTY_SELECT,
  });
  return properties.flatMap((property) => {
    const tenancy = currentTenancy(property);
    return tenancy?.leaseEnd ? [{ propertyId: property.id, propertyLabel: property.label, tenancy }] : [];
  });
}

/** Every rented Property's current Tenancy with a lease end. Empty while the Home module is off. */
export function getCurrentTenancies(): Promise<CurrentTenancy[]> {
  return currentTenanciesWhere({});
}

/**
 * The Tenancy, if it's the current one of its rented Property (by the same
 * rule) and has a lease end; else null. Only looks at that one Property.
 */
export async function getCurrentTenancy(tenancyId: string): Promise<CurrentTenancy | null> {
  const agreement = await prisma.rentalAgreement.findUnique({ where: { id: tenancyId }, select: { propertyId: true } });
  if (!agreement) return null;
  const [current] = await currentTenanciesWhere({ id: agreement.propertyId });
  return current?.tenancy.id === tenancyId ? current : null;
}
