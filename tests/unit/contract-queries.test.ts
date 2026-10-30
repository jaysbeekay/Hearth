// #394 — one set of Contract queries (and whats_due) behind both MCP and the
// Assistant, answered from the Due policy in the household's day.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";

// The exchange-rate cache is seeded below; never reach out to Yahoo.
vi.mock("@/lib/fx", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fx")>()),
  refreshFxRates: vi.fn(async () => {}),
}));

const db = setupTestDb();

const {
  queryContracts,
  getContract,
  searchContracts,
  upcomingRenewals,
  spendSummary,
  whatsDue,
  queryProducts,
  defaultSpendCurrency,
} = await import("@/lib/domainQueries");
const { setAppSetting } = await import("@/lib/appSettings");
const { createMcpServer } = await import("@/lib/mcp/server");
const { getAvailableTools, runTool } = await import("@/lib/chat/tools");
const { daysUntil } = await import("@/lib/utils");

async function connectMcp() {
  const server = await createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "contract-queries-test", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

// Today is 24 Oct 2026 in the household's day.
const NOW = new Date("2026-10-24T12:00:00.000Z");
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await setAppSetting("household.timezone", "UTC");
});

afterEach(() => {
  vi.useRealTimers();
});

type UserId = string;

async function seedContracts(createdById: UserId) {
  const base = { createdById, provider: "Acme" };
  const make = (data: Record<string, unknown>) =>
    db.prisma.contract.create({ data: { ...base, ...data } as Parameters<typeof db.prisma.contract.create>[0]["data"] });
  return {
    // Notice deadline 3 Nov (10 days), end date 3 Dec (40 days).
    phone: await make({
      title: "Phone plan",
      category: "TELECOM",
      renewalType: "AUTO_RENEW",
      endDate: day("2026-12-03"),
      noticePeriodDays: 30,
      cost: 50,
      currency: "AUD",
      billingFrequency: "MONTHLY",
      contactName: "Sam",
      contactPhone: "0400 000 000",
      contactEmail: "sam@acme.test",
      isTaxDeductible: true,
      notes: "Includes roaming",
    }),
    // End date 13 Nov (20 days), Due soon.
    car: await make({
      title: "Car insurance",
      category: "CAR_INSURANCE",
      renewalType: "MANUAL_RENEWAL",
      endDate: day("2026-11-13"),
      cost: 1200,
      currency: "USD",
      billingFrequency: "ANNUALLY",
    }),
    // Fixed term that ended 10 days ago: Ended, never Due.
    gym: await make({
      title: "Gym",
      category: "SUBSCRIPTION",
      renewalType: "FIXED_TERM",
      endDate: day("2026-10-14"),
      cost: 30,
      currency: "AUD",
      billingFrequency: "MONTHLY",
    }),
    // Auto-renewed 20 days ago: waiting on its new end date (Housekeeping).
    streaming: await make({
      title: "Streaming",
      category: "SUBSCRIPTION",
      renewalType: "AUTO_RENEW",
      endDate: day("2026-10-04"),
    }),
    // Manual renewal that ended 5 days ago: Expired, overdue.
    lease: await make({
      title: "Storage unit",
      category: "RENTAL",
      renewalType: "MANUAL_RENEWAL",
      endDate: day("2026-10-19"),
      cost: 1000,
      currency: "JPY",
      billingFrequency: "WEEKLY",
    }),
    cancelled: await make({
      title: "Old broadband",
      category: "UTILITY",
      status: "CANCELLED",
      renewalType: "MANUAL_RENEWAL",
      endDate: day("2026-11-01"),
      cost: 999,
      currency: "AUD",
      billingFrequency: "MONTHLY",
    }),
    // Well outside the horizon; a one-off cost.
    loan: await make({
      title: "Car loan",
      category: "LOAN",
      renewalType: "MANUAL_RENEWAL",
      endDate: day("2027-03-01"),
      cost: 600,
      currency: "AUD",
      billingFrequency: "ONE_OFF",
    }),
    trashed: await make({
      title: "Trashed plan",
      category: "TELECOM",
      renewalType: "MANUAL_RENEWAL",
      endDate: day("2026-10-30"),
      deletedAt: new Date(),
    }),
  };
}

async function seedFxRate() {
  await db.prisma.fxRate.create({ data: { pair: "USD_AUD", rate: 1.5, cachedAt: new Date() } });
}

describe("Contract shape", () => {
  it("is the union of both tools' fields, with the Due policy's entries instead of day counts", async () => {
    const user = await createTestUser();
    const { phone } = await seedContracts(user.id);
    const contracts = await queryContracts();
    const json = contracts.find((c) => c.id === phone.id)!;

    expect(json).toMatchObject({
      title: "Phone plan",
      contactName: "Sam",
      contactPhone: "0400 000 000",
      contactEmail: "sam@acme.test",
      isTaxDeductible: true,
      startDate: null,
      endDate: "2026-12-03",
      estimatedMonthlySpend: 50,
      state: "due-soon",
      due: [{ field: "noticeDeadline", date: "2026-11-03", daysLeft: 10, state: "due-soon", label: "Cancel by 3 Nov" }],
    });
    for (const gone of ["daysUntilEnd", "cancelBy", "daysUntilCancelBy", "daysUntilDeadline", "createdById", "documents"]) {
      expect(json).not.toHaveProperty(gone);
    }
  });

  it("gives each state its glossary meaning", async () => {
    const user = await createTestUser();
    await seedContracts(user.id);
    const byTitle = new Map((await queryContracts()).map((c) => [c.title, c]));
    expect(byTitle.get("Gym")?.state).toBe("ended");
    expect(byTitle.get("Streaming")?.state).toBe("needs-new-end-date");
    expect(byTitle.get("Storage unit")?.due[0]).toMatchObject({ state: "overdue", daysLeft: -5, label: "Expired 5 days ago" });
    expect(byTitle.get("Old broadband")).toMatchObject({ state: null, due: [] });
    expect(byTitle.has("Trashed plan")).toBe(false);
  });

  it("filters by status and category", async () => {
    const user = await createTestUser();
    await seedContracts(user.id);
    expect((await queryContracts({ status: "CANCELLED" })).map((c) => c.title)).toEqual(["Old broadband"]);
    expect((await queryContracts({ category: "SUBSCRIPTION" })).map((c) => c.title).sort()).toEqual(["Gym", "Streaming"]);
  });
});

describe("getContract", () => {
  it("lists document metadata only, leaving out trashed documents", async () => {
    const user = await createTestUser();
    const { phone } = await seedContracts(user.id);
    const doc = { contractId: phone.id, storedName: "stored-uuid.pdf", mimeType: "application/pdf", size: 123 };
    await db.prisma.document.create({ data: { ...doc, filename: "plan.pdf", extractedText: "secret text" } });
    await db.prisma.document.create({ data: { ...doc, filename: "old.pdf", deletedAt: new Date() } });

    const json = await getContract(phone.id);
    expect(json?.contactEmail).toBe("sam@acme.test");
    expect(json?.documents).toHaveLength(1);
    expect(Object.keys(json!.documents[0]).sort()).toEqual(["filename", "id", "mimeType", "size", "uploadedAt"]);
    expect(JSON.stringify(json)).not.toContain("secret text");
    expect(JSON.stringify(json)).not.toContain("stored-uuid");
  });

  it("is null for a missing or trashed Contract", async () => {
    const user = await createTestUser();
    const { trashed } = await seedContracts(user.id);
    expect(await getContract("nope")).toBeNull();
    expect(await getContract(trashed.id)).toBeNull();
  });
});

describe("searchContracts", () => {
  it("matches title, provider, contract number and notes, never trashed Contracts", async () => {
    const user = await createTestUser();
    await seedContracts(user.id);
    expect((await searchContracts("roaming")).map((c) => c.title)).toEqual(["Phone plan"]);
    expect((await searchContracts("plan")).map((c) => c.title)).toEqual(["Phone plan"]);
    expect(await searchContracts("acme")).toHaveLength(7);
  });
});

describe("upcomingRenewals", () => {
  it("counts down to the notice deadline and leaves out Ended, Cancelled and needs-new-end-date Contracts", async () => {
    const user = await createTestUser();
    await seedContracts(user.id);
    const upcoming = await upcomingRenewals();
    // The Phone plan's end date is 40 days off, but its notice deadline is 10 (#351).
    expect(upcoming.map((c) => c.title)).toEqual(["Storage unit", "Phone plan", "Car insurance"]);
  });

  it("respects the horizon", async () => {
    const user = await createTestUser();
    await seedContracts(user.id);
    expect((await upcomingRenewals(5)).map((c) => c.title)).toEqual(["Storage unit"]);
    expect((await upcomingRenewals(200)).map((c) => c.title)).toEqual([
      "Storage unit",
      "Phone plan",
      "Car insurance",
      "Car loan",
    ]);
  });
});

describe("an auto-renewing Contract with no notice period inside the horizon", () => {
  async function seedRenewal() {
    const user = await createTestUser();
    return db.prisma.contract.create({
      data: {
        title: "Cloud storage",
        provider: "Acme",
        category: "SUBSCRIPTION",
        renewalType: "AUTO_RENEW",
        endDate: day("2026-11-08"),
        createdById: user.id,
      },
    });
  }

  it("is listed by upcoming_renewals as a later renewal date, not as Due", async () => {
    await seedRenewal();
    const [renewal] = await upcomingRenewals();
    expect(renewal).toMatchObject({
      title: "Cloud storage",
      state: "later",
      due: [{ field: "endDate", date: "2026-11-08", daysLeft: 15, state: "later", label: "Renews 8 Nov" }],
    });
  });

  it("is not in whats_due, since it renews by itself", async () => {
    await seedRenewal();
    expect(await whatsDue(new Set(), 30)).toEqual([]);
  });
});

describe("spendSummary", () => {
  it("converts to the asked currency like the dashboard, and lists what it couldn't convert", async () => {
    const user = await createTestUser();
    await seedContracts(user.id);
    await seedFxRate();
    const summary = await spendSummary("aud");
    // Phone 50 + car 1200 USD a year at 1.5 (150) + gym 30. JPY has no rate;
    // the one-off loan has no monthly cost; Cancelled and trashed don't count.
    expect(summary).toEqual({
      currency: "AUD",
      estimatedMonthlySpendTotal: 230,
      byCategory: { "Car insurance": 150, Telecom: 50, Subscription: 30 },
      unconvertedCurrencies: ["JPY"],
    });
  });

  it("has categories that add up to its total, leaving out ones with no monthly spend", async () => {
    const user = await createTestUser();
    await seedContracts(user.id);
    await seedFxRate();
    const summary = await spendSummary("AUD");
    const categorySum = Object.values(summary.byCategory).reduce((sum, n) => sum + n, 0);
    expect(categorySum).toBeCloseTo(summary.estimatedMonthlySpendTotal, 2);
    // The one-off loan, and the JPY storage unit with no rate, add nothing.
    expect(summary.byCategory).not.toHaveProperty("Loan");
    expect(summary.byCategory).not.toHaveProperty("Rental");
  });

  it("rejects a currency that isn't an ISO 4217 code, on both surfaces", async () => {
    const admin = await createTestUser({ role: "ADMIN" });
    const ctx = { userId: admin.id, role: "ADMIN" as const, enabledModules: new Set<never>() };
    expect(JSON.parse(await runTool("spend_summary", { currency: "XYZ" }, ctx))).toEqual({
      error: "Invalid arguments for this tool.",
    });
    expect(JSON.parse(await runTool("spend_summary", { currency: "aud" }, ctx))).toMatchObject({ currency: "AUD" });
    const client = await connectMcp();
    const result = await client.callTool({ name: "spend_summary", arguments: { currency: "XYZ" } });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("defaults to the member's preferred currency, or the first admin's for MCP", async () => {
    const admin = await createTestUser({ role: "ADMIN" });
    await db.prisma.user.update({ where: { id: admin.id }, data: { preferredCurrency: "NZD" } });
    const member = await createTestUser();
    await db.prisma.user.update({ where: { id: member.id }, data: { preferredCurrency: "USD" } });
    expect(await defaultSpendCurrency(member.id)).toBe("USD");
    expect(await defaultSpendCurrency()).toBe("NZD");
  });
});

describe("whatsDue", () => {
  async function seedEverything() {
    const user = await createTestUser();
    await seedContracts(user.id);
    await db.prisma.product.createMany({
      data: [
        { description: "Fridge", warrantyEndDate: day("2026-11-07"), createdById: user.id },
        { description: "Old kettle", warrantyEndDate: day("2026-10-01"), createdById: user.id },
      ],
    });
    await db.prisma.vehicle.create({
      data: {
        label: "Hatchback",
        regoExpiry: day("2026-10-22"),
        insuranceExpiry: day("2027-06-01"),
        nextServiceDue: day("2026-11-20"),
        createdById: user.id,
      },
    });
    const property = await db.prisma.property.create({
      data: { label: "Unit 4", isRented: true, occupancyStatus: "RENTED", createdById: user.id },
    });
    await db.prisma.rentalAgreement.create({
      data: { propertyId: property.id, weeklyRent: 500, tenantName: "Kim", leaseStart: day("2026-01-01"), leaseEnd: day("2026-11-14") },
    });
  }

  it("lists every Due entry within the horizon, soonest first, for enabled modules only", async () => {
    await seedEverything();
    const all = await whatsDue(new Set(["VEHICLES", "HOME"]));
    expect(all.map((e) => [e.kind, e.title, e.field, e.daysLeft, e.state])).toEqual([
      ["contract", "Storage unit", "endDate", -5, "overdue"],
      ["vehicle", "Hatchback", "regoExpiry", -2, "overdue"],
      ["contract", "Phone plan", "noticeDeadline", 10, "due-soon"],
      ["warranty", "Fridge", "warrantyEndDate", 14, "due-soon"],
      ["contract", "Car insurance", "endDate", 20, "due-soon"],
      ["tenancy", "Unit 4", "leaseEnd", 21, "due-soon"],
      ["vehicle", "Hatchback", "nextServiceDue", 27, "due-soon"],
    ]);

    const withoutModules = await whatsDue(new Set());
    expect(withoutModules.map((e) => e.kind)).not.toContain("vehicle");
    expect(withoutModules.map((e) => e.kind)).not.toContain("tenancy");
    expect(withoutModules).toHaveLength(4);
  });

  it("respects the horizon and never lists Ended, Lapsed or Cancelled entries", async () => {
    await seedEverything();
    const soon = await whatsDue(new Set(["VEHICLES", "HOME"]), 12);
    expect(soon.map((e) => e.title)).toEqual(["Storage unit", "Hatchback", "Phone plan"]);
    const wide = await whatsDue(new Set(["VEHICLES", "HOME"]), 3650);
    const titles = wide.map((e) => e.title);
    for (const never of ["Gym", "Old kettle", "Old broadband", "Streaming", "Trashed plan"]) {
      expect(titles).not.toContain(never);
    }
    // Only Due entries: the Car loan's end date is months off, outside its window.
    expect(wide.every((e) => e.state === "due-soon" || e.state === "overdue")).toBe(true);
    expect(titles).not.toContain("Car loan");
  });
});

describe("day counts west of UTC (#394)", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("reads a UTC-midnight date as its own calendar day", () => {
    process.env.TZ = "America/Los_Angeles";
    // 3 Nov's UTC midnight is still 2 Nov in Los Angeles; read locally, the
    // count used to come out a day short.
    vi.setSystemTime(new Date("2026-10-24T12:00:00.000Z"));
    expect(daysUntil(day("2026-11-03"), "2026-10-24")).toBe(10);
    expect(daysUntil("2026-11-03T00:00:00.000Z", "2026-10-24")).toBe(10);
    expect(daysUntil(null, "2026-10-24")).toBeNull();
    expect(daysUntil("not a date", "2026-10-24")).toBeNull();
  });

  it("counts Contracts and Warranties in the household's day, whatever the server's zone", async () => {
    process.env.TZ = "America/Los_Angeles";
    const user = await createTestUser();
    await seedContracts(user.id);
    await db.prisma.product.create({ data: { description: "Fridge", warrantyEndDate: day("2026-11-07"), createdById: user.id } });

    const phone = (await queryContracts()).find((c) => c.title === "Phone plan");
    expect(phone?.due[0]).toMatchObject({ date: "2026-11-03", daysLeft: 10 });
    expect((await queryProducts())[0].daysUntilWarrantyEnd).toBe(14);

    // East of UTC, the household's day is already the 25th.
    await setAppSetting("household.timezone", "Pacific/Auckland");
    vi.setSystemTime(new Date("2026-10-24T12:30:00.000Z"));
    expect((await queryProducts())[0].daysUntilWarrantyEnd).toBe(13);
  });
});

describe("MCP and the Assistant", () => {
  async function callMcp(client: Client, name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text: string }[];
    return JSON.parse(content[0].text);
  }

  it("give identical output for every tool both offer", async () => {
    const admin = await createTestUser({ role: "ADMIN" });
    const { phone } = await seedContracts(admin.id);
    await seedFxRate();
    await db.prisma.product.create({ data: { description: "Fridge", warrantyEndDate: day("2026-11-07"), createdById: admin.id } });
    // WEALTH stays off on purpose, so net_worth isn't offered: it prices
    // holdings from live Yahoo/CoinGecko feeds, and it already has a single
    // shared implementation (getNetWorth) that both surfaces call directly.
    for (const key of ["TRAVEL", "VEHICLES", "HOME", "INVENTORY"] as const) await setModuleEnabled(key, true);
    const enabledModules = new Set(["TRAVEL", "VEHICLES", "HOME", "INVENTORY"] as const);

    const client = await connectMcp();
    const mcpTools = (await client.listTools()).tools.map((t) => t.name);
    const assistantTools = new Set(getAvailableTools("ADMIN", enabledModules).map((t) => t.name));
    // The Assistant offers every MCP tool; it only adds its guarded propose_* tools.
    expect(mcpTools.filter((name) => !assistantTools.has(name))).toEqual([]);
    expect(mcpTools).toContain("whats_due");

    const inputs = new Map<string, Record<string, unknown>[]>([
      ["list_contracts", [{}, { status: "ACTIVE" }, { category: "SUBSCRIPTION" }]],
      ["get_contract", [{ id: phone.id }, { id: "missing" }]],
      ["search_contracts", [{ query: "plan" }]],
      ["upcoming_renewals", [{}, { withinDays: 5 }]],
      ["spend_summary", [{ currency: "AUD" }, {}]],
      ["whats_due", [{}, { withinDays: 365 }]],
      ["list_products", [{}]],
      ["list_trips", [{}]],
      ["list_vehicles", [{}]],
      ["list_properties", [{}]],
      ["list_inventory_items", [{}]],
    ]);
    expect([...inputs.keys()].sort()).toEqual([...mcpTools].sort());

    const ctx = { userId: admin.id, role: "ADMIN" as const, enabledModules: new Set(enabledModules) };
    for (const [name, cases] of inputs) {
      for (const args of cases) {
        const fromMcp = await callMcp(client, name, args);
        const fromAssistant = JSON.parse(await runTool(name, args, ctx));
        expect(fromAssistant, `${name} ${JSON.stringify(args)}`).toEqual(fromMcp);
      }
    }
    await client.close();
  });

  it("describe Contract tools in the glossary's terms", async () => {
    const client = await connectMcp();
    const tools = new Map((await client.listTools()).tools.map((t) => [t.name, t.description ?? ""]));
    const assistant = new Map(getAvailableTools("MEMBER", new Set()).map((t) => [t.name, t.description]));
    for (const name of ["list_contracts", "get_contract", "search_contracts", "upcoming_renewals", "spend_summary", "whats_due"]) {
      expect(assistant.get(name)).toBe(tools.get(name));
    }
    expect(tools.get("upcoming_renewals")).toMatch(/Due/);
    expect(tools.get("upcoming_renewals")).toMatch(/Ended/);
    expect(tools.get("upcoming_renewals")).toMatch(/Expired/);
    expect(tools.get("whats_due")).toMatch(/Lapsed/);
    expect(tools.get("spend_summary")).not.toMatch(/regardless of currency/);
    await client.close();
  });

  it("MCP stays read-only: only the allowlisted read tools, and no record changes after every call", async () => {
    const admin = await createTestUser({ role: "ADMIN" });
    const { phone } = await seedContracts(admin.id);
    await seedFxRate();
    await db.prisma.product.create({ data: { description: "Fridge", warrantyEndDate: day("2026-11-07"), createdById: admin.id } });
    await db.prisma.vehicle.create({ data: { label: "Hatchback", regoExpiry: day("2026-11-01"), createdById: admin.id } });
    const property = await db.prisma.property.create({
      data: { label: "Unit 4", isRented: true, occupancyStatus: "RENTED", createdById: admin.id },
    });
    await db.prisma.rentalAgreement.create({ data: { propertyId: property.id, weeklyRent: 500, leaseEnd: day("2026-11-14") } });
    for (const key of ["TRAVEL", "VEHICLES", "HOME", "INVENTORY", "WEALTH"] as const) await setModuleEnabled(key, true);

    const client = await connectMcp();
    const names = (await client.listTools()).tools.map((t) => t.name);
    // Every tool with every module on. A new tool must be added here
    // deliberately, after checking it's read-only.
    expect([...names].sort()).toEqual(
      [
        "get_contract",
        "list_contracts",
        "list_inventory_items",
        "list_products",
        "list_properties",
        "list_trips",
        "list_vehicles",
        "net_worth",
        "search_contracts",
        "spend_summary",
        "upcoming_renewals",
        "whats_due",
      ].sort(),
    );

    const snapshot = async () => ({
      contracts: await db.prisma.contract.findMany({ orderBy: { id: "asc" } }),
      products: await db.prisma.product.findMany({ orderBy: { id: "asc" } }),
      vehicles: await db.prisma.vehicle.findMany({ orderBy: { id: "asc" } }),
      properties: await db.prisma.property.findMany({ orderBy: { id: "asc" }, include: { rentalAgreements: true } }),
    });
    const before = await snapshot();
    const args = new Map<string, Record<string, unknown>>([
      ["search_contracts", { query: "a" }],
      ["get_contract", { id: phone.id }],
    ]);
    // net_worth is left out: it prices holdings from live feeds.
    for (const name of names.filter((n) => n !== "net_worth")) {
      const result = await client.callTool({ name, arguments: args.get(name) ?? {} });
      expect(result.isError, name).toBeFalsy();
    }
    expect(await snapshot()).toEqual(before);
    await client.close();
  });
});
