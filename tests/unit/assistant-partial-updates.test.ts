// The Assistant's update proposals write only the fields it named (#420):
// a cost-only change mustn't reset status or tax-deductible to the schema's
// defaults, or touch notes and dates.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { createContractCommand } from "@/lib/commands/contracts";
import { createProductCommand } from "@/lib/commands/products";
import { updateContractFromAssistant } from "@/lib/actions/contracts";
import { updateProductFromAssistant } from "@/lib/actions/products";
import { contractSchema } from "@/lib/validation/contract";
import { productSchema } from "@/lib/validation/product";
import { runTool, type ToolContext } from "@/lib/chat/tools";
import { auth } from "@/lib/auth";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const db = setupTestDb();

let actorId: string;
let ctx: ToolContext;

beforeEach(async () => {
  vi.clearAllMocks();
  actorId = (await createTestUser()).id;
  ctx = { userId: actorId, role: "MEMBER", enabledModules: new Set() };
  vi.mocked(auth).mockResolvedValue({ user: { id: actorId, role: "MEMBER" } } as never);
});

const newContract = () =>
  createContractCommand(
    contractSchema.parse({
      title: "Gym",
      category: "SUBSCRIPTION",
      provider: "FitCo",
      renewalType: "MANUAL_RENEWAL",
      startDate: "2026-01-01",
      endDate: "2027-06-01",
      cost: 60,
      currency: "NZD",
      status: "CANCELLED",
      notes: "Joined in January",
      isTaxDeductible: true,
    }),
    actorId,
  );

const savedContract = (id: string) => db.prisma.contract.findUniqueOrThrow({ where: { id } });

async function propose(name: string, input: Record<string, unknown>) {
  return JSON.parse(await runTool(name, input, ctx)) as {
    proposed?: boolean;
    error?: string;
    label?: string;
    data?: Record<string, unknown>;
  };
}

describe("propose_update_contract", () => {
  it("carries only the named keys, with the record's name for the card", async () => {
    const contract = await newContract();
    const result = await propose("propose_update_contract", { contractId: contract.id, cost: 70 });
    expect(result.proposed).toBe(true);
    expect(result.label).toBe("Gym");
    expect(result.data).toEqual({ cost: 70 });
  });

  it("refuses a proposal with nothing to change, or an unknown contract", async () => {
    const contract = await newContract();
    expect((await propose("propose_update_contract", { contractId: contract.id })).error).toBe(
      "Name at least one field to change.",
    );
    expect((await propose("propose_update_contract", { contractId: "nope", cost: 1 })).error).toBe(
      "No contract with that id.",
    );
  });

  it("still validates the named fields", async () => {
    const contract = await newContract();
    const result = await propose("propose_update_contract", { contractId: contract.id, title: "" });
    expect(result.error).toBe("Title is required");
    const dates = await propose("propose_update_contract", {
      contractId: contract.id,
      startDate: "2026-05-01",
      endDate: "2026-04-01",
    });
    expect(dates.error).toBe("End date can't be before the start date.");
  });

  it("create proposals still fill the full record's defaults", async () => {
    const result = await propose("propose_create_contract", {
      title: "Netflix",
      category: "SUBSCRIPTION",
      provider: "Netflix",
      renewalType: "AUTO_RENEW",
    });
    expect(result.data).toMatchObject({ status: "ACTIVE", isTaxDeductible: false, currency: "AUD" });
  });
});

describe("updateContractFromAssistant", () => {
  it("a cost-only update leaves status, tax-deductible, notes and dates untouched", async () => {
    const contract = await newContract();
    const { data } = await propose("propose_update_contract", { contractId: contract.id, cost: 70 });
    expect(await updateContractFromAssistant(contract.id, data!)).toEqual({ success: true, contractId: contract.id });

    const saved = await savedContract(contract.id);
    expect(saved.cost).toBe(70);
    expect(saved.status).toBe("CANCELLED");
    expect(saved.isTaxDeductible).toBe(true);
    expect(saved.currency).toBe("NZD");
    expect(saved.notes).toBe("Joined in January");
    expect(saved.startDate?.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(saved.endDate?.toISOString().slice(0, 10)).toBe("2027-06-01");
    expect(saved.title).toBe("Gym");
    expect(saved.renewalType).toBe("MANUAL_RENEWAL");
  });

  it("naming isTaxDeductible or status sets it", async () => {
    const contract = await newContract();
    await db.prisma.contract.update({ where: { id: contract.id }, data: { isTaxDeductible: false } });
    expect((await updateContractFromAssistant(contract.id, { isTaxDeductible: true, status: "ACTIVE" })).success).toBe(
      true,
    );
    const saved = await savedContract(contract.id);
    expect(saved.isTaxDeductible).toBe(true);
    expect(saved.status).toBe("ACTIVE");
  });

  it("ignores keys the action wasn't sent, even when the data is tampered with", async () => {
    const contract = await newContract();
    // An unknown key is stripped; a blank one changes nothing.
    expect((await updateContractFromAssistant(contract.id, { cost: 75, createdById: "x", notes: "" })).success).toBe(
      true,
    );
    const saved = await savedContract(contract.id);
    expect(saved.cost).toBe(75);
    expect(saved.notes).toBe("Joined in January");
    expect(saved.createdById).toBe(actorId);
  });

  it("refuses an end date before the saved start date, with the command's message", async () => {
    const contract = await newContract();
    expect(await updateContractFromAssistant(contract.id, { endDate: "2025-12-01" })).toEqual({
      success: false,
      error: "End date can't be before the start date.",
    });
    expect((await savedContract(contract.id)).endDate?.toISOString().slice(0, 10)).toBe("2027-06-01");
  });

  it("refuses an empty update", async () => {
    const contract = await newContract();
    expect(await updateContractFromAssistant(contract.id, {})).toEqual({
      success: false,
      error: "Name at least one field to change.",
    });
  });
});

describe("product updates", () => {
  const newProduct = () =>
    createProductCommand(
      productSchema.parse({
        description: "TV",
        purchaseDate: "2026-01-01",
        warrantyEndDate: "2028-01-01",
        currency: "USD",
        notes: "Lounge room",
      }),
      actorId,
    );

  it("propose and update only the named fields", async () => {
    const product = await newProduct();
    const result = await propose("propose_update_product", { productId: product.id, price: 999 });
    expect(result.label).toBe("TV");
    expect(result.data).toEqual({ price: 999 });
    expect((await updateProductFromAssistant(product.id, result.data!)).success).toBe(true);

    const saved = await db.prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(saved.price).toBe(999);
    expect(saved.currency).toBe("USD");
    expect(saved.notes).toBe("Lounge room");
    expect(saved.warrantyEndDate?.toISOString().slice(0, 10)).toBe("2028-01-01");
  });

  it("refuses a warranty end before the saved purchase date", async () => {
    const product = await newProduct();
    expect(await updateProductFromAssistant(product.id, { warrantyEndDate: "2025-06-01" })).toEqual({
      success: false,
      error: "Warranty end date can't be before the purchase date.",
    });
  });
});
