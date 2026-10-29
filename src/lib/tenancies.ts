// #388 — the Tenancies whose lease end can carry Reminders: each rented
// Property's current Tenancy (currentTenancy in dueRecords.ts), the same
// ones whose lease end is Due on the dashboard, Upcoming and iCal. Older
// agreements are history, so their lease ends never remind. Shared by the
// scheduler and the household Reminder roll-up so they agree on the set.

import { prisma } from "@/lib/prisma";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { currentTenancy, TENANCY_AGREEMENT_SELECT } from "@/lib/dueRecords";

export interface CurrentTenancy {
  propertyId: string;
  propertyLabel: string;
  tenancy: {
    id: string;
    tenantName: string | null;
    leaseStart: Date | null;
    leaseEnd: Date | null;
    reminderDaysBefore: string | null;
    createdAt: Date;
  };
}

/** Every rented Property's current Tenancy with a lease end. Empty while the Home module is off. */
export async function getCurrentTenancies(): Promise<CurrentTenancy[]> {
  if (!(await isModuleEnabled("HOME"))) return [];
  const properties = await prisma.property.findMany({
    where: { deletedAt: null, isRented: true },
    select: { id: true, label: true, isRented: true, rentalAgreements: { select: TENANCY_AGREEMENT_SELECT } },
  });
  return properties.flatMap((property) => {
    const tenancy = currentTenancy(property);
    return tenancy?.leaseEnd ? [{ propertyId: property.id, propertyLabel: property.label, tenancy }] : [];
  });
}
