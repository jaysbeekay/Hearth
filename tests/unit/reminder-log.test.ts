import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import { createVehicleCommand, updateVehicleCommand } from "@/lib/commands/vehicles";
import { createContractCommand, updateContractCommand } from "@/lib/commands/contracts";
import { contractSchema } from "@/lib/validation/contract";
import { runExpirationCheck } from "@/lib/notifications/scheduler";
import {
  backfillNotificationLogDates,
  ensureNotificationLogBackfill,
  resetNotificationLogBackfillForTests,
} from "@/lib/notifications/logBackfill";
import { getCurrentReminderFailures, getNotificationLogsByOwner, toSentLogRow } from "@/lib/notifications/logs";
import { reminderPlan } from "@/lib/notifications/reminderSchedule";
import { getEnabledWebhookEndpoints, sendExpiryWebhooks } from "@/lib/notifications/webhook";
import { getReminderHealth } from "@/lib/notifications/health";
import { addDays, householdDay } from "@/lib/duePolicy";

// The date-keyed sent-Reminder log (#387, ADR 0003) against a real
// migrated database: the upgrade backfill, and commands that move a date
// letting Reminders fire again with no reset anywhere.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// One configured channel (a webhook) whose sends we can count.
vi.mock("@/lib/notifications/webhook", () => ({
  getEnabledWebhookEndpoints: vi.fn(async () => [{ id: "hook", url: "https://example.test/hook", secret: null, secretEncrypted: false }]),
  sendExpiryWebhooks: vi.fn(async () => undefined),
}));

const db = setupTestDb();
let actorId: string;

beforeEach(async () => {
  vi.mocked(sendExpiryWebhooks).mockReset();
  vi.mocked(sendExpiryWebhooks).mockResolvedValue(undefined);
  actorId = (await createTestUser()).id;
  await setModuleEnabled("VEHICLES", true);
  // Pin the household day so the dates below don't depend on the machine.
  await db.prisma.appSetting.create({ data: { key: "household.timezone", value: "UTC", updatedAt: new Date() } });
});

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

// A legacy row as the pre-#387 scheduler wrote it: no date, and no field
// for contracts and products.
function legacyRow(ownerType: "CONTRACT" | "PRODUCT" | "VEHICLE", ownerId: string, field: string, thresholdDays: number, sentAt: string) {
  return db.prisma.notificationLog.create({
    data: { ownerType, ownerId, field, channel: "WEBHOOK", thresholdDays, status: "SENT", sentAt: new Date(sentAt) },
  });
}

function contractInput(overrides: Record<string, unknown>) {
  return contractSchema.parse({
    title: "Home insurance",
    category: "HOME_INSURANCE",
    provider: "Insurer",
    renewalType: "MANUAL_RENEWAL",
    ...overrides,
  });
}

async function webhookSendNow(ownerType: "CONTRACT" | "PRODUCT" | "VEHICLE", record: Parameters<typeof reminderPlan>[0], id: string, today: string) {
  const logs = (await getNotificationLogsByOwner(ownerType, [id])).get(id) ?? [];
  return reminderPlan(record, { today, defaultReminderDays: "30,14,7,1" }, logs.map(toSentLogRow)).entries.map(
    (e) => e.schedule.WEBHOOK.sendNow,
  );
}

describe("upgrade backfill", () => {
  it("dates a row still in its threshold's window, so it keeps counting", async () => {
    const vehicle = await createVehicleCommand({ label: "Hatch", regoExpiry: day("2026-11-01") }, actorId);
    const row = await legacyRow("VEHICLE", vehicle.id, "regoExpiry", 30, "2026-10-05T08:00:00Z");

    expect(await backfillNotificationLogDates({ serverTimeZone: "UTC" })).toBe(1);
    const after = await db.prisma.notificationLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.dueDate?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    // The 30-day Reminder isn't sent again on upgrade.
    expect(await webhookSendNow("VEHICLE", { kind: "vehicle", ...vehicle }, vehicle.id, "2026-10-10")).toEqual([null]);
  });

  it("leaves a row from an earlier date stale: kept, never counted (#382)", async () => {
    // Rego was renewed after last year's Reminder, and nothing cleared the log.
    const vehicle = await createVehicleCommand({ label: "Ute", regoExpiry: day("2027-11-01") }, actorId);
    const row = await legacyRow("VEHICLE", vehicle.id, "regoExpiry", 7, "2026-10-26T08:00:00Z");

    expect(await backfillNotificationLogDates({ serverTimeZone: "UTC" })).toBe(0);
    const after = await db.prisma.notificationLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.dueDate).toBeNull();
    expect(await webhookSendNow("VEHICLE", { kind: "vehicle", ...vehicle }, vehicle.id, "2027-10-26")).toEqual([7]);
  });

  it("dates Contract rows against the notice deadline or end date they counted down to", async () => {
    const withNotice = await createContractCommand(
      contractInput({ endDate: "2026-12-30", noticePeriodDays: 30 }),
      actorId,
    );
    const noNotice = await createContractCommand(contractInput({ endDate: "2026-11-10" }), actorId);
    const notice = await legacyRow("CONTRACT", withNotice.id, "", 14, "2026-11-20T08:00:00Z");
    const end = await legacyRow("CONTRACT", noNotice.id, "", 30, "2026-10-15T08:00:00Z");
    const old = await legacyRow("CONTRACT", noNotice.id, "", 14, "2025-10-27T08:00:00Z");

    expect(await backfillNotificationLogDates({ serverTimeZone: "UTC" })).toBe(2);
    expect(await db.prisma.notificationLog.findUniqueOrThrow({ where: { id: notice.id } })).toMatchObject({
      field: "noticeDeadline",
      dueDate: day("2026-11-30"),
    });
    expect(await db.prisma.notificationLog.findUniqueOrThrow({ where: { id: end.id } })).toMatchObject({
      field: "endDate",
      dueDate: day("2026-11-10"),
    });
    expect(await db.prisma.notificationLog.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({
      field: "",
      dueDate: null,
    });
  });

  it("dates Warranty rows against the warranty end date", async () => {
    const product = await db.prisma.product.create({
      data: { description: "Fridge", warrantyEndDate: day("2026-11-24"), createdById: actorId },
    });
    const current = await legacyRow("PRODUCT", product.id, "", 30, "2026-10-26T08:00:00Z");
    const stale = await legacyRow("PRODUCT", product.id, "", 14, "2025-11-10T08:00:00Z");

    expect(await backfillNotificationLogDates({ serverTimeZone: "UTC" })).toBe(1);
    expect(await db.prisma.notificationLog.findUniqueOrThrow({ where: { id: current.id } })).toMatchObject({
      field: "warrantyEndDate",
      dueDate: day("2026-11-24"),
    });
    expect((await db.prisma.notificationLog.findUniqueOrThrow({ where: { id: stale.id } })).dueDate).toBeNull();
  });
});

describe("moving a date lets Reminders fire again, with no reset", () => {
  it("renewing a Vehicle's rego", async () => {
    const vehicle = await createVehicleCommand({ label: "Wagon", regoExpiry: day("2026-11-01") }, actorId);

    await runExpirationCheck(new Date("2026-10-26T09:00:00Z"));
    expect(sendExpiryWebhooks).toHaveBeenCalledTimes(1);
    await runExpirationCheck(new Date("2026-10-26T10:00:00Z"));
    expect(sendExpiryWebhooks).toHaveBeenCalledTimes(1);

    await updateVehicleCommand(vehicle.id, { regoExpiry: day("2027-11-01") }, actorId);
    await runExpirationCheck(new Date("2027-10-26T09:00:00Z"));
    expect(sendExpiryWebhooks).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendExpiryWebhooks).mock.calls[1][0]).toMatchObject({ kind: "vehicle", vehicleField: "regoExpiry", daysRemaining: 6 });
    // Last year's row is still there, as history.
    expect(await db.prisma.notificationLog.count({ where: { ownerId: vehicle.id, status: "SENT" } })).toBe(2);
  });

  it("moving a Contract's end date", async () => {
    const contract = await createContractCommand(contractInput({ endDate: "2026-11-01" }), actorId);

    await runExpirationCheck(new Date("2026-10-26T09:00:00Z"));
    await runExpirationCheck(new Date("2026-10-26T10:00:00Z"));
    expect(sendExpiryWebhooks).toHaveBeenCalledTimes(1);

    await updateContractCommand(contract.id, contractInput({ endDate: "2026-11-02" }), actorId);
    await runExpirationCheck(new Date("2026-10-26T11:00:00Z"));
    expect(sendExpiryWebhooks).toHaveBeenCalledTimes(2);
    expect(await db.prisma.notificationLog.count({ where: { ownerId: contract.id } })).toBe(2);
  });

  it("holds a Contract's Reminders while it Needs review", async () => {
    await createContractCommand(contractInput({ endDate: "2026-11-01" }), actorId, { extractionPending: true });
    await runExpirationCheck(new Date("2026-10-26T09:00:00Z"));
    expect(sendExpiryWebhooks).not.toHaveBeenCalled();
  });
});

// The old scheduler counted days in the server's own zone (TZ): the local
// calendar day of the stored UTC-midnight date minus the local day of the
// moment. The backfill has to count the same way, or rows it sent stay
// undated and the current Reminder goes out again on upgrade.
describe("upgrade backfill counts days the way the old scheduler did", () => {
  async function vehicleWithRow(sentAt: string, thresholdDays = 30) {
    const vehicle = await createVehicleCommand({ label: "Hatch", regoExpiry: day("2026-11-30") }, actorId);
    const row = await legacyRow("VEHICLE", vehicle.id, "regoExpiry", thresholdDays, sentAt);
    return { vehicle, row };
  }

  it("west of UTC (America/New_York): a threshold sent a day early by the old count still counts", async () => {
    // Noon 30 Oct in New York. The old count: 30 Nov's stored date is 29 Nov
    // locally, so this was 30 days out and the 30-day Reminder went.
    const { vehicle, row } = await vehicleWithRow("2026-10-30T16:00:00Z");

    expect(await backfillNotificationLogDates({ serverTimeZone: "America/New_York" })).toBe(1);
    expect((await db.prisma.notificationLog.findUniqueOrThrow({ where: { id: row.id } })).dueDate).toEqual(
      day("2026-11-30"),
    );
    // Not sent again on 5 Nov.
    expect(await webhookSendNow("VEHICLE", { kind: "vehicle", ...vehicle }, vehicle.id, "2026-11-05")).toEqual([null]);
  });

  it("west of UTC: a Contract's notice-deadline row is matched with the same count", async () => {
    const contract = await createContractCommand(contractInput({ endDate: "2026-12-30", noticePeriodDays: 30 }), actorId);
    // 10am 16 Nov in New York; the deadline (30 Nov) is 29 Nov locally: 13 days out.
    const row = await legacyRow("CONTRACT", contract.id, "", 14, "2026-11-16T15:00:00Z");

    expect(await backfillNotificationLogDates({ serverTimeZone: "America/New_York" })).toBe(1);
    expect(await db.prisma.notificationLog.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      field: "noticeDeadline",
      dueDate: day("2026-11-30"),
    });
  });

  it("east of UTC (Australia/Sydney): counts in Sydney's day", async () => {
    // 7am 31 Oct in Sydney: 30 days out, in the window.
    const { row: inWindow } = await vehicleWithRow("2026-10-30T20:00:00Z");
    expect(await backfillNotificationLogDates({ serverTimeZone: "Australia/Sydney" })).toBe(1);
    expect((await db.prisma.notificationLog.findUniqueOrThrow({ where: { id: inWindow.id } })).dueDate).toEqual(
      day("2026-11-30"),
    );
  });

  it("east of UTC: a row 31 Sydney days out wasn't this date's 30-day Reminder", async () => {
    // 7am 30 Oct in Sydney, still 29 Oct in UTC.
    const { row } = await vehicleWithRow("2026-10-29T20:00:00Z");
    expect(await backfillNotificationLogDates({ serverTimeZone: "Australia/Sydney" })).toBe(0);
    expect((await db.prisma.notificationLog.findUniqueOrThrow({ where: { id: row.id } })).dueDate).toBeNull();
  });

  it("UTC: the window is 0 to the threshold days out, inclusive", async () => {
    const vehicle = await createVehicleCommand({ label: "Ute", regoExpiry: day("2026-11-30") }, actorId);
    const edge = await legacyRow("VEHICLE", vehicle.id, "regoExpiry", 30, "2026-10-31T08:00:00Z");
    const early = await legacyRow("VEHICLE", vehicle.id, "regoExpiry", 14, "2026-11-15T08:00:00Z");
    const onTheDay = await legacyRow("VEHICLE", vehicle.id, "regoExpiry", 1, "2026-11-30T08:00:00Z");

    expect(await backfillNotificationLogDates({ serverTimeZone: "UTC" })).toBe(2);
    const dueDateOf = async (id: string) => (await db.prisma.notificationLog.findUniqueOrThrow({ where: { id } })).dueDate;
    expect(await dueDateOf(edge.id)).toEqual(day("2026-11-30"));
    expect(await dueDateOf(early.id)).toBeNull(); // 15 days out: before the 14-day window
    expect(await dueDateOf(onTheDay.id)).toEqual(day("2026-11-30"));
  });

  it("leaves a row undated when a dated row already holds its key", async () => {
    const { vehicle, row } = await vehicleWithRow("2026-11-10T12:00:00Z");
    await db.prisma.notificationLog.create({
      data: {
        ownerType: "VEHICLE",
        ownerId: vehicle.id,
        field: "regoExpiry",
        channel: "WEBHOOK",
        thresholdDays: 30,
        dueDate: day("2026-11-30"),
        status: "SENT",
        sentAt: new Date("2026-11-10T13:00:00Z"),
      },
    });
    expect(await backfillNotificationLogDates({ serverTimeZone: "UTC" })).toBe(0);
    expect((await db.prisma.notificationLog.findUniqueOrThrow({ where: { id: row.id } })).dueDate).toBeNull();
  });
});

describe("the backfill marker", () => {
  // Rows sent at midday UTC 20 days out, in the window in any server zone.
  async function undatedRow() {
    const vehicle = await createVehicleCommand({ label: "Wagon", regoExpiry: day("2026-11-30") }, actorId);
    return legacyRow("VEHICLE", vehicle.id, "regoExpiry", 30, "2026-11-10T12:00:00Z");
  }
  const marker = () => db.prisma.appSetting.findUnique({ where: { key: "notifications.logDatesBackfilledAt" } });

  beforeEach(() => resetNotificationLogBackfillForTests());

  it("runs once, sets the marker, and doesn't run again", async () => {
    const first = await undatedRow();
    await ensureNotificationLogBackfill();
    expect((await db.prisma.notificationLog.findUniqueOrThrow({ where: { id: first.id } })).dueDate).not.toBeNull();
    expect(await marker()).not.toBeNull();

    // A new process (so no in-memory memo) with the marker set: nothing runs.
    resetNotificationLogBackfillForTests();
    const second = await undatedRow();
    await ensureNotificationLogBackfill();
    expect((await db.prisma.notificationLog.findUniqueOrThrow({ where: { id: second.id } })).dueDate).toBeNull();
  });

  it("doesn't set the marker when a run fails, so the next read retries", async () => {
    const row = await undatedRow();
    const update = vi
      .spyOn(db.prisma.notificationLog, "update")
      .mockRejectedValueOnce(new Error("database is locked"));
    try {
      await expect(ensureNotificationLogBackfill()).rejects.toThrow("database is locked");
      expect(await marker()).toBeNull();
      expect((await db.prisma.notificationLog.findUniqueOrThrow({ where: { id: row.id } })).dueDate).toBeNull();

      await ensureNotificationLogBackfill();
      expect((await db.prisma.notificationLog.findUniqueOrThrow({ where: { id: row.id } })).dueDate).toEqual(
        day("2026-11-30"),
      );
      expect(await marker()).not.toBeNull();
    } finally {
      update.mockRestore();
    }
  });
});

describe("a failure a later threshold's send replaced", () => {
  it("drops off the dashboard and the health card once the 1-day Reminder goes", async () => {
    resetNotificationLogBackfillForTests();
    const vehicle = await createVehicleCommand({ label: "Wagon", regoExpiry: day("2026-11-30") }, actorId);
    const records = {
      CONTRACT: new Map(),
      PRODUCT: new Map(),
      VEHICLE: new Map([[vehicle.id, { kind: "vehicle" as const, ...vehicle }]]),
    };
    const ctx = (today: string) => ({ today, defaultReminderDays: "30,14,7,1" });

    // The 30- and 14-day Reminders go; then the webhook fails from 7 days out to 2.
    await runExpirationCheck(new Date("2026-10-31T09:00:00Z"));
    await runExpirationCheck(new Date("2026-11-16T09:00:00Z"));
    vi.mocked(sendExpiryWebhooks).mockRejectedValue(new Error("webhook down"));
    for (const d of ["2026-11-23", "2026-11-25", "2026-11-28"]) await runExpirationCheck(new Date(`${d}T09:00:00Z`));

    const failing = await getCurrentReminderFailures(records, ctx("2026-11-28"));
    expect(failing).toHaveLength(1);
    expect(failing[0]).toMatchObject({ ownerId: vehicle.id, thresholdDays: 7, channel: "WEBHOOK", status: "FAILED" });

    // The webhook recovers; the 1-day Reminder goes and the 7-day one never retries.
    vi.mocked(sendExpiryWebhooks).mockResolvedValue(undefined);
    await runExpirationCheck(new Date("2026-11-29T09:00:00Z"));
    expect(await db.prisma.notificationLog.count({ where: { ownerId: vehicle.id, status: "FAILED" } })).toBe(1);
    expect(await getCurrentReminderFailures(records, ctx("2026-11-29"))).toEqual([]);
  });

  it("still counts when the later send was on another channel", async () => {
    const vehicle = await createVehicleCommand({ label: "Wagon", regoExpiry: day("2026-11-30") }, actorId);
    const base = { ownerType: "VEHICLE" as const, ownerId: vehicle.id, field: "regoExpiry", dueDate: day("2026-11-30") };
    await db.prisma.notificationLog.createMany({
      data: [
        { ...base, channel: "EMAIL", thresholdDays: 7, status: "FAILED", sentAt: new Date("2026-11-23T09:00:00Z") },
        { ...base, channel: "WEBHOOK", thresholdDays: 1, status: "SENT", sentAt: new Date("2026-11-29T09:00:00Z") },
      ],
    });
    const records = { CONTRACT: new Map(), PRODUCT: new Map(), VEHICLE: new Map([[vehicle.id, { kind: "vehicle" as const, ...vehicle }]]) };
    const failing = await getCurrentReminderFailures(records, { today: "2026-11-29", defaultReminderDays: "30,14,7,1" });
    expect(failing.map((f) => f.channel)).toEqual(["EMAIL"]);
  });
});

describe("Reminder health reports the channels the scheduler sends on", () => {
  // getReminderHealth reads the real clock, so the dates follow today.
  const today = householdDay(new Date(), "UTC");
  const rego = addDays(today, 20);

  async function setUp() {
    const vehicle = await createVehicleCommand({ label: "Hatch", regoExpiry: day(rego) }, actorId);
    // The 30-day Reminder already went by webhook.
    await db.prisma.notificationLog.create({
      data: {
        ownerType: "VEHICLE",
        ownerId: vehicle.id,
        field: "regoExpiry",
        channel: "WEBHOOK",
        thresholdDays: 30,
        dueDate: day(rego),
        status: "SENT",
        sentAt: new Date(),
      },
    });
    for (const [key, value] of [
      ["smtp.host", "smtp.example.test"],
      ["smtp.user", "hearth"],
    ]) {
      await db.prisma.appSetting.create({ data: { key, value, updatedAt: new Date() } });
    }
    return vehicle;
  }
  const health = (vehicle: Awaited<ReturnType<typeof setUp>>) =>
    getReminderHealth({ ownerType: "VEHICLE", ownerId: vehicle.id, record: { kind: "vehicle", ...vehicle }, field: "regoExpiry" });

  it("doesn't count email when SMTP is set up but nobody gets reminder emails", async () => {
    const vehicle = await setUp();
    await db.prisma.user.updateMany({ data: { emailReminders: false } });

    const h = await health(vehicle);
    expect(h.channels).toEqual({ email: false, ntfy: false, webhook: true });
    // Not "On the next check" for an email that never goes: the next one is the 14-day Reminder.
    expect(h.nextReminder).toEqual({ kind: "on", date: day(addDays(rego, -14)) });
  });

  it("counts email once someone gets reminder emails", async () => {
    const vehicle = await setUp();

    const h = await health(vehicle);
    expect(h.channels).toEqual({ email: true, ntfy: false, webhook: true });
    expect(h.nextReminder).toEqual({ kind: "next-check" });
  });

  it("with only email set up and nobody receiving it, delivery isn't ready", async () => {
    const vehicle = await setUp();
    await db.prisma.user.updateMany({ data: { emailReminders: false } });
    vi.mocked(getEnabledWebhookEndpoints).mockResolvedValueOnce([]);

    const h = await health(vehicle);
    expect(h.channels).toEqual({ email: false, ntfy: false, webhook: false });
    expect(h.deliveryReady).toBe(false);
  });
});
