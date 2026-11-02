// #529 — data import over MCP: agents only propose, a member approves.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createMcpServer } from "@/lib/mcp/server";
import {
  MAX_PENDING_IMPORTS,
  approveImportCommand,
  findImportDuplicates,
  proposeImport,
  rejectImportCommand,
} from "@/lib/mcp/imports";
import { parseImportLabels } from "@/lib/mcp/auth";
import { approveMcpImports, rejectMcpImports } from "@/lib/actions/mcpImports";
import { __clearAllRateLimits } from "@/lib/rateLimit";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

setupTestDb();

const CONTRACT = {
  title: "Home insurance",
  category: "HOME_INSURANCE",
  provider: "Acme Insure",
  renewalType: "AUTO_RENEW",
  contractNumber: "POL-123",
  endDate: "2027-06-30",
  cost: 120,
  currency: "AUD",
  billingFrequency: "MONTHLY",
  notes: "Imported from the broker's email",
};

let actorId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  __clearAllRateLimits();
  actorId = (await createTestUser()).id;
  signInAs("MEMBER");
});

function signInAs(role: "ADMIN" | "MEMBER" | "READONLY") {
  vi.mocked(auth).mockResolvedValue({ user: { id: actorId, role } } as never);
}

async function connect(importLabel?: string) {
  const server = await createMcpServer({ importLabel });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "mcp-imports-test", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("import scope", () => {
  it("parses MCP_IMPORT_LABELS", () => {
    expect([...parseImportLabels(" claude-code, default ,bad label,")]).toEqual(["claude-code", "default"]);
    expect(parseImportLabels(undefined).size).toBe(0);
  });

  it("offers propose_import_* tools only to a token with the scope", async () => {
    await setModuleEnabled("INVENTORY", true);
    const readOnly = await connect();
    expect((await readOnly.listTools()).tools.some((t) => t.name.startsWith("propose_import_"))).toBe(false);

    const importer = await connect("claude-code");
    const names = (await importer.listTools()).tools.map((t) => t.name).filter((n) => n.startsWith("propose_"));
    expect(names.sort()).toEqual([
      "propose_import_contract",
      "propose_import_inventory_item",
      "propose_import_product",
    ]);
  });

  it("leaves out the inventory tool while Inventory is off", async () => {
    const importer = await connect("claude-code");
    const names = (await importer.listTools()).tools.map((t) => t.name);
    expect(names).toContain("propose_import_contract");
    expect(names).not.toContain("propose_import_inventory_item");
  });
});

describe("proposing over MCP", () => {
  it("queues a proposal and writes no record", async () => {
    const client = await connect("claude-code");
    const result = await client.callTool({ name: "propose_import_contract", arguments: CONTRACT });
    expect(result.isError).toBeFalsy();

    expect(await prisma.contract.count()).toBe(0);
    const proposals = await prisma.mcpImportProposal.findMany();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      kind: "CONTRACT",
      status: "PENDING",
      tokenLabel: "claude-code",
      summary: "Home insurance · Acme Insure",
    });
  });

  it("reports an invalid field by name", async () => {
    const result = await proposeImport("CONTRACT", { ...CONTRACT, endDate: "2027-01-01", startDate: "2027-02-01" }, "x");
    expect(result).toEqual({ ok: false, error: "endDate: End date can't be before the start date." });
    const email = await proposeImport("CONTRACT", { ...CONTRACT, contactEmail: "not-an-email" }, "x");
    expect(email.ok).toBe(false);
    if (!email.ok) expect(email.error).toMatch(/^contactEmail:/);
  });

  it("drops record links an agent tries to set", async () => {
    await proposeImport("CONTRACT", { ...CONTRACT, propertyId: "prop-1", vehicleId: "veh-1" }, "x");
    const stored = JSON.parse((await prisma.mcpImportProposal.findFirstOrThrow()).data);
    expect(stored).not.toHaveProperty("propertyId");
    expect(stored).not.toHaveProperty("vehicleId");
  });

  it("refuses new proposals once the queue is full", async () => {
    await prisma.mcpImportProposal.createMany({
      data: Array.from({ length: MAX_PENDING_IMPORTS }, () => ({
        kind: "PRODUCT" as const,
        data: "{}",
        summary: "x",
        tokenLabel: "x",
      })),
    });
    const result = await proposeImport("CONTRACT", CONTRACT, "x");
    expect(result.ok).toBe(false);
  });
});

describe("reviewing", () => {
  it("approval creates the record through the command and records the reviewer", async () => {
    const proposed = await proposeImport("CONTRACT", CONTRACT, "claude-code");
    if (!proposed.ok) throw new Error(proposed.error);

    const { recordId } = await approveImportCommand(proposed.proposalId, actorId);
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: recordId } });
    expect(contract).toMatchObject({ title: "Home insurance", provider: "Acme Insure", createdById: actorId, cost: 120 });
    expect(contract.endDate?.toISOString().slice(0, 10)).toBe("2027-06-30");

    const proposal = await prisma.mcpImportProposal.findUniqueOrThrow({ where: { id: proposed.proposalId } });
    expect(proposal).toMatchObject({ status: "APPROVED", recordId, reviewedById: actorId });

    await expect(approveImportCommand(proposed.proposalId, actorId)).rejects.toThrow("already been reviewed");
    expect(await prisma.contract.count()).toBe(1);
  });

  it("creates products and inventory items", async () => {
    await setModuleEnabled("INVENTORY", true);
    const product = await proposeImport("PRODUCT", { description: "Dishwasher", manufacturer: "Bosch", warrantyEndDate: "2028-01-01" }, "x");
    const item = await proposeImport("INVENTORY_ITEM", { label: "Drill", brand: "Makita", purchasePrice: 199 }, "x");
    if (!product.ok || !item.ok) throw new Error("propose failed");
    await approveImportCommand(product.proposalId, actorId);
    await approveImportCommand(item.proposalId, actorId);
    expect(await prisma.product.count()).toBe(1);
    expect(await prisma.inventoryItem.count()).toBe(1);
  });

  it("keeps an inventory proposal pending when Inventory has been turned off", async () => {
    await setModuleEnabled("INVENTORY", true);
    const item = await proposeImport("INVENTORY_ITEM", { label: "Drill" }, "x");
    if (!item.ok) throw new Error(item.error);
    await setModuleEnabled("INVENTORY", false);
    await expect(approveImportCommand(item.proposalId, actorId)).rejects.toThrow();
    expect((await prisma.mcpImportProposal.findUniqueOrThrow({ where: { id: item.proposalId } })).status).toBe("PENDING");
  });

  it("rejection writes nothing", async () => {
    const proposed = await proposeImport("CONTRACT", CONTRACT, "x");
    if (!proposed.ok) throw new Error(proposed.error);
    await rejectImportCommand(proposed.proposalId, actorId);
    expect(await prisma.contract.count()).toBe(0);
    expect((await prisma.mcpImportProposal.findUniqueOrThrow({ where: { id: proposed.proposalId } })).status).toBe("REJECTED");
  });

  it("bulk actions report each failure and carry on", async () => {
    const a = await proposeImport("CONTRACT", CONTRACT, "x");
    const b = await proposeImport("CONTRACT", { ...CONTRACT, title: "Car insurance" }, "x");
    if (!a.ok || !b.ok) throw new Error("propose failed");
    await rejectImportCommand(a.proposalId, actorId);

    const result = await approveMcpImports([a.proposalId, b.proposalId, "missing"]);
    expect(result.ok).toBe(1);
    expect(result.failed.map((f) => f.id)).toEqual([a.proposalId, "missing"]);
    expect(await prisma.contract.count()).toBe(1);
  });

  it("refuses READONLY members", async () => {
    const proposed = await proposeImport("CONTRACT", CONTRACT, "x");
    if (!proposed.ok) throw new Error(proposed.error);
    signInAs("READONLY");
    await expect(approveMcpImports([proposed.proposalId])).rejects.toThrow("read-only");
    await expect(rejectMcpImports([proposed.proposalId])).rejects.toThrow("read-only");
  });

  it("flags likely duplicates of existing records", async () => {
    const first = await proposeImport("CONTRACT", CONTRACT, "x");
    if (!first.ok) throw new Error(first.error);
    await approveImportCommand(first.proposalId, actorId);

    const again = await proposeImport("CONTRACT", { ...CONTRACT, title: "Renamed policy" }, "x");
    const fresh = await proposeImport("CONTRACT", { ...CONTRACT, title: "Other", contractNumber: "POL-999" }, "x");
    if (!again.ok || !fresh.ok) throw new Error("propose failed");
    const pending = await prisma.mcpImportProposal.findMany({ where: { status: "PENDING" } });
    const hints = await findImportDuplicates(pending);
    expect(hints.get(again.proposalId)?.[0].label).toBe("Home insurance · Acme Insure");
    expect(hints.has(fresh.proposalId)).toBe(false);
  });
});
