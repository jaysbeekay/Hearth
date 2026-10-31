import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import {
  COVERING_CONTRACTS,
  coveredFieldOf,
  isCovering,
  vehicleCovers,
  withVehicleCovers,
  type CoveringContractRow,
} from "@/lib/covers";
import { vehicleDue, vehicleDueRecord } from "@/lib/dueRecords";
import { reminderEntries } from "@/lib/notifications/reminderSchedule";
import { runExpirationCheck } from "@/lib/notifications/scheduler";
import { getReminderHealth } from "@/lib/notifications/health";
import { buildVehicleAttentionItems } from "@/lib/needsAttention";
import { vehicleDueFilter } from "@/lib/listDue";
import { queryVehicles, whatsDue } from "@/lib/domainQueries";
import { sendExpiryWebhooks } from "@/lib/notifications/webhook";
import { buildCategoryBreakdown } from "@/lib/spend";
import type { DueContext } from "@/lib/duePolicy";

// #456 - a Contract that Covers a Vehicle supplies its rego or insurance
// date and the Vehicle's own Due entry for it is switched off.

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
const ctx: DueContext = { today: "2026-10-24", defaultReminderDays: "30,14,7,1" };

let n = 0;
function row(over: Partial<CoveringContractRow> = {}): CoveringContractRow {
  n += 1;
  return {
    id: `c${n}`,
    title: `Policy ${n}`,
    provider: "Allianz",
    category: "CAR_INSURANCE",
    status: "ACTIVE",
    endDate: day("2027-03-01"),
    createdAt: new Date(2026, 0, n),
    deletedAt: null,
    ...over,
  };
}

describe("what Covers a Vehicle", () => {
  it("maps car insurance to the insurance date and registration to the rego date", () => {
    expect(coveredFieldOf("CAR_INSURANCE")).toBe("insuranceExpiry");
    expect(coveredFieldOf("REGISTRATION")).toBe("regoExpiry");
    expect(coveredFieldOf("HOME_INSURANCE")).toBeNull();
    expect(coveredFieldOf("OTHER")).toBeNull();
  });

  it("is an active, live Contract in a Covering Category with an end date", () => {
    expect(isCovering(row())).toBe(true);
    expect(isCovering(row({ category: "REGISTRATION" }))).toBe(true);
    expect(isCovering(row({ status: "CANCELLED" }))).toBe(false);
    expect(isCovering(row({ deletedAt: new Date() }))).toBe(false);
    expect(isCovering(row({ endDate: null }))).toBe(false);
    expect(isCovering(row({ category: "UTILITY" }))).toBe(false);
  });

  it("gives each date at most one cover, taken from the Contract that ends last", () => {
    const early = row({ endDate: day("2026-12-01") });
    const late = row({ endDate: day("2027-12-01") });
    const rego = row({ category: "REGISTRATION", endDate: day("2027-01-15") });
    const covers = vehicleCovers([early, late, rego]);
    expect(covers.map((c) => [c.field, c.contract.id, c.date])).toEqual([
      ["insuranceExpiry", late.id, late.endDate],
      ["regoExpiry", rego.id, rego.endDate],
    ]);
  });

  it("breaks a tie on end date by the Contract entered last", () => {
    const first = row();
    const second = row();
    expect(vehicleCovers([second, first])[0].contract.id).toBe(second.id);
  });

  it("ignores a cancelled Contract, so the next one (or the manual date) takes over", () => {
    const cancelled = row({ status: "CANCELLED", endDate: day("2028-01-01") });
    const live = row({ endDate: day("2027-01-01") });
    expect(vehicleCovers([cancelled, live])[0].contract.id).toBe(live.id);
    expect(vehicleCovers([cancelled])).toEqual([]);
  });
});

describe("a Vehicle with a Covering Contract", () => {
  const vehicle = {
    regoExpiry: day("2026-11-03"),
    insuranceExpiry: day("2026-10-30"),
    nextServiceDue: day("2026-11-10"),
    reminderDaysBefore: null,
  };

  it("shows the Contract's end date and keeps the manual one in the row", () => {
    const policy = row({ endDate: day("2027-02-02") });
    const derived = withVehicleCovers({ ...vehicle, contracts: [policy] });
    expect(derived.insuranceExpiry).toEqual(day("2027-02-02"));
    expect(derived.regoExpiry).toEqual(vehicle.regoExpiry);
    expect(derived.coveredFields).toEqual(["insuranceExpiry"]);
  });

  it("has no Due entry of its own for the Covered date", () => {
    const covered = vehicleDue({ ...vehicle, contracts: [row()] }, ctx).map((e) => e.field);
    expect(covered).toEqual(["regoExpiry", "nextServiceDue"]);
    const open = vehicleDue({ ...vehicle, contracts: [] }, ctx).map((e) => e.field);
    expect(open).toEqual(["insuranceExpiry", "regoExpiry", "nextServiceDue"]);
  });

  it("has no Reminder entry of its own for the Covered date", () => {
    const record = vehicleDueRecord({ ...vehicle, contracts: [row(), row({ category: "REGISTRATION" })] });
    expect(reminderEntries(record, ctx).map((e) => e.field)).toEqual(["nextServiceDue"]);
  });

  it("resumes the manual date when the Contract is cancelled or trashed", () => {
    const fields = (c: CoveringContractRow) => vehicleDue({ ...vehicle, contracts: [c] }, ctx).map((e) => e.field);
    expect(fields(row({ status: "CANCELLED" }))).toContain("insuranceExpiry");
    expect(fields(row({ deletedAt: new Date() }))).toContain("insuranceExpiry");
  });

  it("shows up in Needs attention once, through the Contract", () => {
    const items = buildVehicleAttentionItems([{ id: "v", label: "Car", ...vehicle, contracts: [row()] }], ctx);
    expect(items.map((i) => i.entry?.field)).toEqual(["regoExpiry", "nextServiceDue"]);
  });
});

describe("against the database", () => {
  const db = setupTestDb();
  let createdById: string;

  beforeEach(async () => {
    vi.mocked(sendExpiryWebhooks).mockClear();
    createdById = (await createTestUser()).id;
    await setModuleEnabled("VEHICLES", true);
    await db.prisma.appSetting.create({ data: { key: "household.timezone", value: "UTC", updatedAt: new Date() } });
  });

  async function seed(contract: Record<string, unknown> | null) {
    const vehicle = await db.prisma.vehicle.create({
      data: { label: "Car", createdById, insuranceExpiry: day("2026-11-24"), regoExpiry: day("2026-11-24") },
    });
    const created = contract
      ? await db.prisma.contract.create({
          data: {
            title: "Allianz policy",
            category: "CAR_INSURANCE",
            provider: "Allianz",
            createdById,
            vehicleId: vehicle.id,
            endDate: day("2026-11-24"),
            renewalType: "MANUAL_RENEWAL",
            ...contract,
          } as Parameters<typeof db.prisma.contract.create>[0]["data"],
        })
      : null;
    return { vehicle, contract: created };
  }

  const webhookKinds = () => vi.mocked(sendExpiryWebhooks).mock.calls.map((c) => `${c[0].kind}:${c[0].id}`);

  it("sends one Reminder stream for insurance, from the Contract", async () => {
    const { vehicle, contract } = await seed({});
    await db.prisma.vehicle.update({ where: { id: vehicle.id }, data: { regoExpiry: null } });

    await runExpirationCheck(new Date("2026-10-25T09:00:00Z"));
    expect(webhookKinds()).toEqual([`contract:${contract!.id}`]);
  });

  it("covers registration the same way", async () => {
    const { vehicle, contract } = await seed({ category: "REGISTRATION", title: "Rego" });
    await db.prisma.vehicle.update({ where: { id: vehicle.id }, data: { insuranceExpiry: null } });

    await runExpirationCheck(new Date("2026-10-25T09:00:00Z"));
    expect(webhookKinds()).toEqual([`contract:${contract!.id}`]);
  });

  it("falls back to the manual date when the Contract is cancelled", async () => {
    const { vehicle, contract } = await seed({});
    await db.prisma.vehicle.update({ where: { id: vehicle.id }, data: { regoExpiry: null } });
    await db.prisma.contract.update({ where: { id: contract!.id }, data: { status: "CANCELLED" } });

    await runExpirationCheck(new Date("2026-10-25T09:00:00Z"));
    expect(webhookKinds()).toEqual([`vehicle:${vehicle.id}`]);
  });

  it("falls back to the manual date when the Contract is in Trash or unlinked", async () => {
    const { vehicle, contract } = await seed({});
    await db.prisma.vehicle.update({ where: { id: vehicle.id }, data: { regoExpiry: null } });
    await db.prisma.contract.update({ where: { id: contract!.id }, data: { deletedAt: new Date() } });
    await runExpirationCheck(new Date("2026-10-25T09:00:00Z"));
    expect(webhookKinds()).toEqual([`vehicle:${vehicle.id}`]);

    vi.mocked(sendExpiryWebhooks).mockClear();
    await db.prisma.contract.update({ where: { id: contract!.id }, data: { deletedAt: null, vehicleId: null } });
    await runExpirationCheck(new Date("2026-10-26T09:00:00Z"));
    // The 30-day Reminder for the manual date went on the previous check.
    expect(webhookKinds()).toEqual([`contract:${contract!.id}`]);
  });

  it("gives the Vehicle no Reminder health for the Covered date", async () => {
    const { vehicle } = await seed({});
    const row = await db.prisma.vehicle.findUniqueOrThrow({
      where: { id: vehicle.id },
      include: { contracts: COVERING_CONTRACTS },
    });
    const health = await getReminderHealth({
      ownerType: "VEHICLE",
      ownerId: vehicle.id,
      field: "insuranceExpiry",
      record: vehicleDueRecord(row),
    });
    expect(health.enabled).toBe(false);
  });

  it("leaves the Covered date out of the Vehicle's Due filter and what's due, but reports it to MCP", async () => {
    const { vehicle, contract } = await seed({});
    await db.prisma.vehicle.update({ where: { id: vehicle.id }, data: { regoExpiry: null } });
    await db.prisma.contract.update({ where: { id: contract!.id }, data: { endDate: day("2026-10-30") } });
    const today: DueContext = { today: "2026-10-24", defaultReminderDays: "30,14,7,1" };

    const filter = vehicleDueFilter("soon", today);
    const rows = await db.prisma.vehicle.findMany({ where: filter.where, include: { contracts: COVERING_CONTRACTS } });
    expect(rows.filter(filter.matches)).toEqual([]);

    const [reported] = await queryVehicles();
    expect(reported.insuranceExpiry).toBe("2026-10-30T00:00:00.000Z");
    expect(reported.insuranceCoveredBy).toEqual({ contractId: contract!.id, title: "Allianz policy" });
    expect(reported.regoCoveredBy).toBeNull();

    const due = (await whatsDue(new Set(["VEHICLES"]), 30)) as { kind: string; id: string }[];
    expect(due.filter((d) => d.kind === "vehicle")).toEqual([]);
  });

  it("puts a Registration Contract's cost in Spending", async () => {
    const { contract } = await seed({ category: "REGISTRATION", cost: 840, currency: "AUD", billingFrequency: "ANNUALLY" });
    expect(contract!.category).toBe("REGISTRATION");
    const [bucket] = buildCategoryBreakdown([contract!], "AUD", new Map());
    expect(bucket.category).toBe("REGISTRATION");
    expect(bucket.monthlyTotal).toBeCloseTo(70, 5);
  });
});
