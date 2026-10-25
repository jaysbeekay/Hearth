import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import { createVehicleCommand, updateVehicleCommand } from "@/lib/commands/vehicles";
import { createContractCommand, updateContractCommand } from "@/lib/commands/contracts";
import { contractSchema } from "@/lib/validation/contract";
import { runExpirationCheck } from "@/lib/notifications/scheduler";
import { backfillNotificationLogDates } from "@/lib/notifications/logBackfill";
import { getNotificationLogsByOwner, toSentLogRow } from "@/lib/notifications/logs";
import { reminderPlan } from "@/lib/notifications/reminderSchedule";
import { sendExpiryWebhooks } from "@/lib/notifications/webhook";

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
  vi.mocked(sendExpiryWebhooks).mockClear();
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

    expect(await backfillNotificationLogDates()).toBe(1);
    const after = await db.prisma.notificationLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.dueDate?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    // The 30-day Reminder isn't sent again on upgrade.
    expect(await webhookSendNow("VEHICLE", { kind: "vehicle", ...vehicle }, vehicle.id, "2026-10-10")).toEqual([null]);
  });

  it("leaves a row from an earlier date stale: kept, never counted (#382)", async () => {
    // Rego was renewed after last year's Reminder, and nothing cleared the log.
    const vehicle = await createVehicleCommand({ label: "Ute", regoExpiry: day("2027-11-01") }, actorId);
    const row = await legacyRow("VEHICLE", vehicle.id, "regoExpiry", 7, "2026-10-26T08:00:00Z");

    expect(await backfillNotificationLogDates()).toBe(0);
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

    expect(await backfillNotificationLogDates()).toBe(2);
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

    expect(await backfillNotificationLogDates()).toBe(1);
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
