import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import { COVERING_CONTRACTS, resumedDateMessage, withVehicleCovers } from "@/lib/covers";
import { contractDue, vehicleDue, vehicleDueRecord } from "@/lib/dueRecords";
import { renewContractCommand } from "@/lib/commands/contracts";
import { updateVehicleCommand } from "@/lib/commands/vehicles";
import { vehicleSchema } from "@/lib/validation/vehicles";
import { runExpirationCheck } from "@/lib/notifications/scheduler";
import { queryVehicles, whatsDue } from "@/lib/domainQueries";
import { sendExpiryWebhooks } from "@/lib/notifications/webhook";

// #456 review fixes: edge cases of the Covers rule against a real database.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/notifications/channels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/channels")>();
  return {
    ...actual,
    activeChannels: vi.fn(async () => ({ email: false, ntfy: false, webhook: true, emailRecipients: [] })),
  };
});
vi.mock("@/lib/notifications/webhook", () => ({
  getEnabledWebhookEndpoints: vi.fn(async () => [{ id: "hook", url: "https://example.test/hook", secret: null, secretEncrypted: false }]),
  sendExpiryWebhooks: vi.fn(async () => undefined),
}));

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const db = setupTestDb();
let createdById: string;

beforeEach(async () => {
  vi.mocked(sendExpiryWebhooks).mockClear();
  createdById = (await createTestUser()).id;
  await setModuleEnabled("VEHICLES", true);
  await db.prisma.appSetting.create({ data: { key: "household.timezone", value: "UTC", updatedAt: new Date() } });
});

const webhookKinds = () => vi.mocked(sendExpiryWebhooks).mock.calls.map((c) => `${c[0].kind}:${c[0].id}`);
const ctx = { today: "2026-10-24", defaultReminderDays: "30,14,7,1" };

async function vehicleWith(own: Record<string, Date | null> = {}) {
  return db.prisma.vehicle.create({ data: { label: "Car", createdById, insuranceExpiry: day("2026-11-24"), ...own } });
}
async function policy(vehicleId: string, over: Record<string, unknown> = {}) {
  return db.prisma.contract.create({
    data: {
      title: "Allianz policy",
      category: "CAR_INSURANCE",
      provider: "Allianz",
      createdById,
      vehicleId,
      endDate: day("2026-11-24"),
      renewalType: "MANUAL_RENEWAL",
      ...over,
    } as Parameters<typeof db.prisma.contract.create>[0]["data"],
  });
}
async function vehicleRow(id: string) {
  return db.prisma.vehicle.findUniqueOrThrow({ where: { id }, include: { contracts: COVERING_CONTRACTS } });
}
async function entryFields(id: string) {
  return vehicleDue(await vehicleRow(id), ctx).map((e) => e.field);
}
async function derived(id: string) {
  return withVehicleCovers(await vehicleRow(id)).insuranceExpiry;
}

describe("a Contract awaiting review", () => {
  it("leaves the Vehicle's own date and Reminders alone until confirmed", async () => {
    const v = await vehicleWith();
    const c = await policy(v.id, { extractionPending: true });
    expect(await entryFields(v.id)).toContain("insuranceExpiry");
    expect(await derived(v.id)).toEqual(day("2026-11-24"));

    await runExpirationCheck(new Date("2026-10-25T09:00:00Z"));
    expect(webhookKinds()).toEqual([`vehicle:${v.id}`]);

    await db.prisma.contract.update({ where: { id: c.id }, data: { extractionPending: false, endDate: day("2027-02-02") } });
    expect(await entryFields(v.id)).not.toContain("insuranceExpiry");
    expect(await derived(v.id)).toEqual(day("2027-02-02"));
  });
});

describe("changes to a Covering Contract", () => {
  it("moves into and out of Covering as the category changes", async () => {
    const v = await vehicleWith();
    const c = await policy(v.id, { category: "OTHER" });
    expect(await entryFields(v.id)).toContain("insuranceExpiry");
    await db.prisma.contract.update({ where: { id: c.id }, data: { category: "CAR_INSURANCE" } });
    expect(await entryFields(v.id)).not.toContain("insuranceExpiry");
    await db.prisma.contract.update({ where: { id: c.id }, data: { category: "HOME_INSURANCE" } });
    expect(await entryFields(v.id)).toContain("insuranceExpiry");
  });

  it("stops Covering when the end date is cleared", async () => {
    const v = await vehicleWith();
    const c = await policy(v.id);
    expect(await entryFields(v.id)).not.toContain("insuranceExpiry");
    await db.prisma.contract.update({ where: { id: c.id }, data: { endDate: null } });
    expect(await entryFields(v.id)).toContain("insuranceExpiry");
    expect(await derived(v.id)).toEqual(day("2026-11-24"));
  });

  it("follows a Renew: the Vehicle's derived date moves with the Contract", async () => {
    const v = await vehicleWith();
    const c = await policy(v.id);
    await renewContractCommand(c.id, { startDate: day("2026-11-25"), endDate: day("2027-11-24") }, createdById);
    expect(await derived(v.id)).toEqual(day("2027-11-24"));
  });

  it("covers with the Contract's own state when it is auto-renewing past its end date", async () => {
    const v = await vehicleWith({ insuranceExpiry: day("2026-12-01") });
    const c = await policy(v.id, { renewalType: "AUTO_RENEW", endDate: day("2026-10-01") });
    expect(await entryFields(v.id)).not.toContain("insuranceExpiry");
    expect(contractDue(c, ctx).map((e) => e.state)).toEqual(["needs-new-end-date"]);
  });

  // #487 review: an ended fixed-term policy is a lapse, not a silent date.
  it("makes the Vehicle's date Overdue from a fixed-term Contract's end date once it has ended", async () => {
    // The household's own date is later, so it can't be what raises it.
    const v = await vehicleWith({ insuranceExpiry: day("2026-12-01") });
    const c = await policy(v.id, { renewalType: "FIXED_TERM", endDate: day("2026-10-01") });
    expect(contractDue(c, ctx).map((e) => e.state)).toEqual(["ended"]);
    const entries = vehicleDue(await vehicleRow(v.id), ctx).filter((e) => e.field === "insuranceExpiry");
    expect(entries.map((e) => [e.state, e.date, e.daysLeft])).toEqual([["overdue", "2026-10-01", -23]]);
    expect(await derived(v.id)).toEqual(day("2026-10-01"));
  });

  it("keeps a fixed-term Contract's date silent on the Vehicle while it is still running", async () => {
    const v = await vehicleWith({ insuranceExpiry: day("2026-01-01") });
    await policy(v.id, { renewalType: "FIXED_TERM", endDate: day("2026-11-01") });
    expect(await entryFields(v.id)).not.toContain("insuranceExpiry");
  });

  it("lets a later renewal take over from an ended fixed-term Contract", async () => {
    const v = await vehicleWith();
    await policy(v.id, { renewalType: "FIXED_TERM", endDate: day("2026-10-01") });
    await policy(v.id, { title: "Renewal", renewalType: "FIXED_TERM", endDate: day("2027-10-01") });
    expect(await entryFields(v.id)).not.toContain("insuranceExpiry");
    expect(await derived(v.id)).toEqual(day("2027-10-01"));
  });
});

describe("the Reminder log across Covering", () => {
  it("send, cover, uncover: no resend, and nothing lost", async () => {
    const v = await vehicleWith();
    await runExpirationCheck(new Date("2026-10-25T09:00:00Z"));
    expect(webhookKinds()).toEqual([`vehicle:${v.id}`]);

    const c = await policy(v.id);
    vi.mocked(sendExpiryWebhooks).mockClear();
    await runExpirationCheck(new Date("2026-10-26T09:00:00Z"));
    expect(webhookKinds()).toEqual([`contract:${c.id}`]);

    await db.prisma.contract.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
    vi.mocked(sendExpiryWebhooks).mockClear();
    await runExpirationCheck(new Date("2026-10-27T09:00:00Z"));
    expect(webhookKinds()).toEqual([]);
    const logs = await db.prisma.notificationLog.findMany({ where: { ownerType: "VEHICLE", ownerId: v.id } });
    expect(logs.map((l) => [l.field, l.thresholdDays, l.status])).toEqual([["insuranceExpiry", 30, "SENT"]]);
  });
});

describe("the edit form's hidden manual date", () => {
  it("is kept when the form saves", async () => {
    const v = await vehicleWith({ regoExpiry: day("2026-12-12") });
    await policy(v.id);
    // What the form posts: the Covered date as its hidden manual value.
    const parsed = vehicleSchema.parse({ label: "Car", regoExpiry: "2026-12-12", insuranceExpiry: "2026-11-24" });
    await updateVehicleCommand(v.id, { ...parsed }, createdById);
    const stored = await db.prisma.vehicle.findUniqueOrThrow({ where: { id: v.id } });
    expect(stored.insuranceExpiry).toEqual(day("2026-11-24"));
    expect(stored.regoExpiry).toEqual(day("2026-12-12"));
  });
});

describe("when a Contract stops Covering", () => {
  it("says which manual date applies again, and when it has already passed", () => {
    expect(resumedDateMessage("insuranceExpiry", day("2026-11-24"), "2026-10-24", "24 Nov 2026")).toBe(
      "The vehicle's own insurance date, 24 Nov 2026, will apply again. Update it if it's out of date.",
    );
    expect(resumedDateMessage("insuranceExpiry", day("2024-03-01"), "2026-10-24", "1 Mar 2024")).toContain("already passed");
    expect(resumedDateMessage("regoExpiry", null, "2026-10-24", null)).toContain("no rego date of its own");
  });

  it("shows a resumed past date as overdue instead of hiding it", async () => {
    const v = await vehicleWith({ insuranceExpiry: day("2024-03-01") });
    const c = await policy(v.id);
    expect(await entryFields(v.id)).not.toContain("insuranceExpiry");
    await db.prisma.contract.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
    const entries = vehicleDue(await vehicleRow(v.id), ctx);
    expect(entries.find((e) => e.field === "insuranceExpiry")).toMatchObject({ state: "overdue" });
  });
});

describe("queryVehicles(attentionOnly) and whatsDue", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("agree for auto-renewing and fixed-term Contracts, and for an uncovered Vehicle", async () => {
    const auto = await vehicleWith({ insuranceExpiry: day("2026-10-28") });
    await policy(auto.id, { renewalType: "AUTO_RENEW", endDate: day("2026-10-28") });
    const fixed = await db.prisma.vehicle.create({ data: { label: "Ute", createdById, insuranceExpiry: day("2026-10-01") } });
    await policy(fixed.id, { renewalType: "FIXED_TERM", endDate: day("2026-10-01") });
    const plain = await db.prisma.vehicle.create({ data: { label: "Van", createdById, insuranceExpiry: day("2026-10-28") } });

    const attention = (await queryVehicles(true)).map((v) => v.id);
    const due = ((await whatsDue(new Set(["VEHICLES"]), 30)) as { kind: string; id: string }[])
      .filter((d) => d.kind === "vehicle")
      .map((d) => d.id);
    expect(new Set(attention)).toEqual(new Set(due));
    // The ended fixed-term policy has lapsed, so that Vehicle is Overdue too.
    expect(new Set(attention)).toEqual(new Set([fixed.id, plain.id]));
  });
});

describe("an Archived Vehicle (#355)", () => {
  it("has no Due entries, with or without a Covering Contract, and its record carries archivedAt", async () => {
    const plain = await vehicleWith({ regoExpiry: day("2026-10-30") });
    const covered = await vehicleWith();
    await policy(covered.id);
    for (const v of [plain, covered]) {
      await db.prisma.vehicle.update({ where: { id: v.id }, data: { archivedAt: new Date("2026-10-01T00:00:00Z") } });
      const row = await vehicleRow(v.id);
      expect(vehicleDueRecord(row).archivedAt).not.toBeNull();
      expect(vehicleDue(row, ctx)).toEqual([]);
    }
  });

  it("sends no Reminders, though a Covering Contract still sends its own", async () => {
    const v = await vehicleWith({ regoExpiry: day("2026-11-24") });
    const c = await policy(v.id);
    await db.prisma.vehicle.update({ where: { id: v.id }, data: { archivedAt: new Date("2026-10-01T00:00:00Z") } });
    await runExpirationCheck(new Date("2026-10-25T09:00:00Z"));
    expect(webhookKinds()).toEqual([`contract:${c.id}`]);

    vi.mocked(sendExpiryWebhooks).mockClear();
    await db.prisma.contract.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
    await runExpirationCheck(new Date("2026-10-26T09:00:00Z"));
    expect(webhookKinds()).toEqual([]);
  });
});
