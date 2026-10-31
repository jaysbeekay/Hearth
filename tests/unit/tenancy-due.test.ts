// #384 — a Property's current Tenancy, and its lease end on Upcoming and in
// the iCal feed.
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import { currentTenancy } from "@/lib/dueRecords";
import { getDueContext } from "@/lib/appSettings";
import { addDays } from "@/lib/duePolicy";
import { getCalendarEvents } from "@/lib/calendarEvents";
import { hashToken } from "@/lib/crypto";

const db = setupTestDb();
const { GET } = await import("@/app/api/ical/route");

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function lease(id: string, leaseStart: string | null, leaseEnd: string | null, createdAt: string) {
  return { id, leaseStart: leaseStart ? d(leaseStart) : null, leaseEnd: leaseEnd ? d(leaseEnd) : null, createdAt: d(createdAt), deletedAt: null };
}

describe("currentTenancy", () => {
  it("is the running lease, even when an older one is entered after it", () => {
    const running = lease("running", "2026-01-01", "2026-12-31", "2026-01-02");
    const backEntered = lease("old", "2024-01-01", "2024-12-31", "2026-06-01");
    expect(currentTenancy({ isRented: true, archivedAt: null, rentalAgreements: [running, backEntered] })?.id).toBe("running");
    expect(currentTenancy({ isRented: true, archivedAt: null, rentalAgreements: [backEntered, running] })?.id).toBe("running");
  });

  it("breaks ties on lease end, then on when it was entered", () => {
    const shorter = lease("shorter", "2026-01-01", "2026-06-30", "2026-01-02");
    const longer = lease("longer", "2026-01-01", "2026-12-31", "2026-01-01");
    expect(currentTenancy({ isRented: true, archivedAt: null, rentalAgreements: [longer, shorter] })?.id).toBe("longer");
    const first = lease("first", null, null, "2026-01-01");
    const second = lease("second", null, null, "2026-02-01");
    expect(currentTenancy({ isRented: true, archivedAt: null, rentalAgreements: [second, first] })?.id).toBe("second");
  });

  it("is none for an Archived Property, however current its lease (#355)", () => {
    const running = lease("running", "2026-01-01", "2026-12-31", "2026-01-02");
    expect(currentTenancy({ isRented: true, archivedAt: new Date("2026-10-01T00:00:00Z"), rentalAgreements: [running] })).toBeNull();
  });

  it("is none while rental tracking is off", () => {
    expect(currentTenancy({ isRented: false, archivedAt: null, rentalAgreements: [lease("a", "2026-01-01", "2026-12-31", "2026-01-01")] })).toBeNull();
  });
});

describe("a Tenancy's lease end on Upcoming and in the iCal feed", () => {
  it("shows the current lease's end, not a back-entered one's", async () => {
    const ctx = await getDueContext();
    const user = await createTestUser();
    await setModuleEnabled("HOME", true);
    await db.prisma.user.update({ where: { id: user.id }, data: { icalTokenHash: hashToken("feed-token") } });
    const leaseEnd = addDays(ctx.today, 20);
    const property = await db.prisma.property.create({
      data: { label: "Unit 4", createdById: user.id, isRented: true, occupancyStatus: "RENTED" },
    });
    const running = await db.prisma.rentalAgreement.create({
      data: { propertyId: property.id, weeklyRent: 500, leaseStart: d(addDays(ctx.today, -100)), leaseEnd: d(leaseEnd) },
    });
    // Entered later, but an older lease.
    const old = await db.prisma.rentalAgreement.create({
      data: { propertyId: property.id, weeklyRent: 450, leaseStart: d(addDays(ctx.today, -800)), leaseEnd: d(addDays(ctx.today, 10)) },
    });

    const events = await getCalendarEvents(new Set(["HOME"]), ctx, addDays(ctx.today, 30));
    expect(events.filter((e) => e.kind === "tenancy").map((e) => [e.id, e.date, e.entry?.state])).toEqual([
      [`lease-${running.id}`, leaseEnd, "due-soon"],
    ]);

    const res = await GET(new NextRequest("http://localhost/api/ical?token=feed-token"));
    const ics = await res.text();
    expect(ics).toContain(`UID:lease-${running.id}`);
    expect(ics).toContain(`DTSTART;VALUE=DATE:${leaseEnd.replaceAll("-", "")}`);
    expect(ics).toContain("SUMMARY:Unit 4 lease ends");
    expect(ics).not.toContain(`lease-${old.id}`);
  });
});
