import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import { createTripCommand, createTripSegmentCommand, deleteTripSegmentCommand, restoreTripSegmentCommand } from "@/lib/commands/trips";
import { getDueContext } from "@/lib/appSettings";
import { addDays } from "@/lib/duePolicy";
import { getCalendarEvents } from "@/lib/calendarEvents";
import { queryTrips, queryProperties, whatsDue } from "@/lib/domainQueries";
import { currentTenancy } from "@/lib/dueRecords";
import { createPropertyCommand, createTenancyCommand, deleteTenancyCommand, restoreTenancyCommand } from "@/lib/commands/home";
import { propertySchema, rentalAgreementSchema } from "@/lib/validation/home";
import { getTravelDistanceSummary } from "@/lib/integrations/flightDistance";
import { hashToken } from "@/lib/crypto";

// #427: an entry in Trash is left out of every read that lists or totals
// it, and comes back when it's restored.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const db = setupTestDb();
const { GET } = await import("@/app/api/ical/route");

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

let actorId: string;

beforeEach(async () => {
  actorId = (await createTestUser()).id;
  await db.prisma.user.update({ where: { id: actorId }, data: { icalTokenHash: hashToken(`feed-${actorId}`) } });
  for (const key of ["TRAVEL", "HOME"] as const) await setModuleEnabled(key, true);
});

async function feed() {
  const res = await GET(new NextRequest(`http://localhost/api/ical?token=feed-${actorId}`));
  return res.text();
}

describe("a Tenancy in Trash", () => {
  it("is never the current Tenancy, even when it's the most recent lease", () => {
    const lease = (id: string, start: string, deletedAt: Date | null) => ({
      id,
      leaseStart: d(start),
      leaseEnd: null,
      createdAt: d(start),
      deletedAt,
    });
    const older = lease("older", "2025-01-01", null);
    const trashed = lease("trashed", "2026-01-01", new Date());
    expect(currentTenancy({ isRented: true, rentalAgreements: [older, trashed] })?.id).toBe("older");
    expect(currentTenancy({ isRented: true, rentalAgreements: [trashed] })).toBeNull();
  });

  it("is left out of What's due, Upcoming, the iCal feed and queryProperties", async () => {
    const ctx = await getDueContext();
    const property = await createPropertyCommand(
      propertySchema.parse({ label: "Unit 9", occupancyStatus: "RENTED" }),
      actorId,
    );
    const tenancy = await createTenancyCommand(
      property.id,
      rentalAgreementSchema.parse({ weeklyRent: 500, tenantName: "Sam", leaseEnd: addDays(ctx.today, 20) }),
      actorId,
    );

    const seen = async () => ({
      due: (await whatsDue(new Set(["HOME"]))).some((item) => item.kind === "tenancy" && item.id === property.id),
      upcoming: (await getCalendarEvents(new Set(["HOME"]), ctx, addDays(ctx.today, 30))).some(
        (e) => e.id === `lease-${tenancy.id}`,
      ),
      ical: (await feed()).includes(`lease-${tenancy.id}`),
      tenant: (await queryProperties()).find((p) => p.id === property.id)?.currentTenant?.tenantName ?? null,
    });

    expect(await seen()).toEqual({ due: true, upcoming: true, ical: true, tenant: "Sam" });
    await deleteTenancyCommand(tenancy.id);
    expect(await seen()).toEqual({ due: false, upcoming: false, ical: false, tenant: null });
    await restoreTenancyCommand(tenancy.id);
    expect(await seen()).toEqual({ due: true, upcoming: true, ical: true, tenant: "Sam" });
  });
});

describe("a Trip segment in Trash", () => {
  it("is left out of Upcoming, the iCal feed, queryTrips and the distance totals", async () => {
    const ctx = await getDueContext();
    const start = addDays(ctx.today, 10);
    const trip = await createTripCommand({ title: "Japan", startDate: d(start), endDate: d(addDays(ctx.today, 20)) }, actorId);
    const segment = await createTripSegmentCommand(trip.id, {
      type: "FLIGHT",
      title: "SYD → NRT",
      currency: "AUD",
      startDate: d(start),
    });
    await db.prisma.tripSegment.update({ where: { id: segment.id }, data: { distanceKm: 7800 } });

    const seen = async () => ({
      upcoming: (await getCalendarEvents(new Set(["TRAVEL"]), ctx, addDays(ctx.today, 30))).some(
        (e) => e.id === `segment-${segment.id}`,
      ),
      ical: (await feed()).includes(`segment-${segment.id}`),
      count: (await queryTrips()).find((t) => t.id === trip.id)?.segmentCount,
      km: (await getTravelDistanceSummary()).totalKm,
    });

    expect(await seen()).toEqual({ upcoming: true, ical: true, count: 1, km: 7800 });
    await deleteTripSegmentCommand(segment.id);
    expect(await seen()).toEqual({ upcoming: false, ical: false, count: 0, km: 0 });
    await restoreTripSegmentCommand(segment.id);
    expect(await seen()).toEqual({ upcoming: true, ical: true, count: 1, km: 7800 });
  });
});
