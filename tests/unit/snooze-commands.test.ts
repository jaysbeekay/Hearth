import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import { createContractCommand, updateContractCommand } from "@/lib/commands/contracts";
import { createProductCommand } from "@/lib/commands/products";
import { createVehicleCommand, updateVehicleCommand } from "@/lib/commands/vehicles";
import { snoozeRecordCommand, unsnoozeRecordCommand } from "@/lib/commands/snooze";
import { RecordValidationError } from "@/lib/commands/shared";
import { contractSchema } from "@/lib/validation/contract";
import { runExpirationCheck } from "@/lib/notifications/scheduler";
import { sendExpiryWebhooks } from "@/lib/notifications/webhook";
import { activeSnoozeUntil } from "@/lib/snooze";

// #354 — Snooze against a real migrated database: the scheduler holds a
// Snoozed record's Reminders, sends again once it lapses, and a renewal or
// date edit ends it with no writer clearing it.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
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
  await db.prisma.appSetting.create({ data: { key: "household.timezone", value: "UTC", updatedAt: new Date() } });
});

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const at = (d: string) => new Date(`${d}T09:00:00Z`);

function contractInput(overrides: Record<string, unknown>) {
  return contractSchema.parse({
    title: "Home insurance",
    category: "HOME_INSURANCE",
    provider: "Insurer",
    renewalType: "MANUAL_RENEWAL",
    ...overrides,
  });
}

describe("Snooze and the scheduler", () => {
  it("holds a Snoozed Contract's Reminders, then sends one catch-up when it lapses", async () => {
    const contract = await createContractCommand(contractInput({ endDate: "2026-11-01" }), actorId);
    await snoozeRecordCommand("contract", contract.id, "2026-10-30", "2026-10-23", actorId);

    await runExpirationCheck(at("2026-10-26"));
    await runExpirationCheck(at("2026-10-29"));
    expect(sendExpiryWebhooks).not.toHaveBeenCalled();

    await runExpirationCheck(at("2026-10-30"));
    expect(sendExpiryWebhooks).toHaveBeenCalledTimes(1);
  });

  it("holds a Snoozed Vehicle's Reminders until its Snooze lapses", async () => {
    const vehicle = await createVehicleCommand({ label: "Hatch", regoExpiry: day("2026-11-01") }, actorId);
    await snoozeRecordCommand("vehicle", vehicle.id, "2026-10-28", "2026-10-21", actorId);
    await runExpirationCheck(at("2026-10-27"));
    expect(sendExpiryWebhooks).not.toHaveBeenCalled();
    await runExpirationCheck(at("2026-10-28"));
    expect(sendExpiryWebhooks).toHaveBeenCalledTimes(1);
  });

  it("ends when the Contract's end date moves", async () => {
    const contract = await createContractCommand(contractInput({ endDate: "2026-11-01" }), actorId);
    await snoozeRecordCommand("contract", contract.id, "2026-11-20", "2026-10-23", actorId);
    await updateContractCommand(contract.id, contractInput({ endDate: "2026-11-05" }), actorId);
    await runExpirationCheck(at("2026-10-26"));
    expect(sendExpiryWebhooks).toHaveBeenCalledTimes(1);
  });

  it("ends when a Vehicle's date is edited", async () => {
    const vehicle = await createVehicleCommand({ label: "Wagon", regoExpiry: day("2026-11-01") }, actorId);
    await snoozeRecordCommand("vehicle", vehicle.id, "2026-11-20", "2026-10-23", actorId);
    await updateVehicleCommand(vehicle.id, { insuranceExpiry: day("2027-03-01") }, actorId);
    const row = await db.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(activeSnoozeUntil({ kind: "vehicle", ...row }, "2026-10-26")).toBeNull();
  });
});

describe("Snooze commands", () => {
  it("records who Snoozed, and leaves updatedAt alone so an open edit isn't stale", async () => {
    const product = await createProductCommand({ description: "Fridge", warrantyEndDate: day("2026-11-10") } as never, actorId);
    await snoozeRecordCommand("warranty", product.id, "2026-11-01", "2026-10-25", actorId);
    const row = await db.prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(row.snoozedById).toBe(actorId);
    expect(row.updatedAt.getTime()).toBe(product.updatedAt.getTime());
    expect(activeSnoozeUntil({ kind: "warranty", ...row }, "2026-10-25")).toBe("2026-11-01");

    await unsnoozeRecordCommand("warranty", product.id);
    const after = await db.prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.snoozedUntil).toBeNull();
    expect(after.snoozedById).toBeNull();
  });

  it("refuses today, the past, and more than a year", async () => {
    const contract = await createContractCommand(contractInput({ endDate: "2026-11-01" }), actorId);
    await expect(snoozeRecordCommand("contract", contract.id, "2026-10-25", "2026-10-25", actorId)).rejects.toThrow(
      RecordValidationError,
    );
    await expect(snoozeRecordCommand("contract", contract.id, "2027-12-01", "2026-10-25", actorId)).rejects.toThrow(
      RecordValidationError,
    );
  });

  it("refuses a Vehicle while the Vehicles module is off", async () => {
    const vehicle = await createVehicleCommand({ label: "Ute", regoExpiry: day("2026-11-01") }, actorId);
    await setModuleEnabled("VEHICLES", false);
    await expect(snoozeRecordCommand("vehicle", vehicle.id, "2026-11-01", "2026-10-25", actorId)).rejects.toThrow(
      "Vehicles module is disabled",
    );
  });
});
