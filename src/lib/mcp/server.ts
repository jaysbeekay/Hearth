import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { CONTRACT_CATEGORIES, CONTRACT_STATUSES } from "@/lib/validation/contract";
import { CATEGORY_LABELS, daysUntil, monthlyEquivalent } from "@/lib/utils";
import {
  queryInventoryItems,
  queryProducts,
  queryProperties,
  queryTrips,
  queryVehicles,
} from "@/lib/domainQueries";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getNetWorth } from "@/lib/wealth";

const CONTRACT_SELECT = {
  id: true,
  title: true,
  category: true,
  provider: true,
  contractNumber: true,
  startDate: true,
  endDate: true,
  renewalType: true,
  noticePeriodDays: true,
  cost: true,
  currency: true,
  billingFrequency: true,
  status: true,
  contactName: true,
  contactPhone: true,
  contactEmail: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
};

interface ContractRow {
  startDate: Date | null;
  endDate: Date | null;
  cost: number | null;
  billingFrequency: string | null;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
}

function serializeContract<T extends ContractRow>(contract: T) {
  return {
    ...contract,
    startDate: contract.startDate?.toISOString() ?? null,
    endDate: contract.endDate?.toISOString() ?? null,
    createdAt: contract.createdAt.toISOString(),
    updatedAt: contract.updatedAt.toISOString(),
    daysUntilEnd: daysUntil(contract.endDate),
    estimatedMonthlySpend:
      Math.round(monthlyEquivalent(contract.cost, contract.billingFrequency) * 100) / 100,
  };
}

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export async function createMcpServer() {
  const enabledModules = await getEnabledModuleKeys();

  const server = new McpServer(
    { name: "hearth", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Read-only tools over a household's tracked contracts (rentals, insurance, " +
        "subscriptions, loans, etc), products/warranties, and — depending on which " +
        "optional modules this household has enabled — travel, vehicles, home/" +
        "properties, inventory, and net worth. These never modify data and never " +
        "expose account credentials or uploaded document contents. Only tools for " +
        "enabled modules are listed; if a household disables a module later, the " +
        "corresponding tool disappears on the next connection.",
    },
  );

  server.registerTool(
    "list_contracts",
    {
      title: "List contracts",
      description: "List contracts, optionally filtered by status and/or category.",
      inputSchema: {
        status: z.enum(CONTRACT_STATUSES).optional(),
        category: z.enum(CONTRACT_CATEGORIES).optional(),
      },
    },
    async ({ status, category }) => {
      const contracts = await prisma.contract.findMany({
        where: { ...(status && { status }), ...(category && { category }) },
        select: CONTRACT_SELECT,
        orderBy: { endDate: "asc" },
      });
      return textResult(contracts.map(serializeContract));
    },
  );

  server.registerTool(
    "get_contract",
    {
      title: "Get contract",
      description:
        "Get full details for one contract by id, including attached document metadata " +
        "(filenames only, not file contents).",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      const contract = await prisma.contract.findUnique({
        where: { id },
        select: {
          ...CONTRACT_SELECT,
          documents: {
            select: { id: true, filename: true, mimeType: true, size: true, uploadedAt: true },
          },
        },
      });
      if (!contract) return textResult({ error: `No contract with id "${id}"` });
      return textResult({
        ...serializeContract(contract),
        documents: contract.documents.map((doc) => ({
          ...doc,
          uploadedAt: doc.uploadedAt.toISOString(),
        })),
      });
    },
  );

  server.registerTool(
    "search_contracts",
    {
      title: "Search contracts",
      description: "Case-insensitive search across title, provider, contract number, and notes.",
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => {
      const contracts = await prisma.contract.findMany({
        where: {
          OR: [
            { title: { contains: query } },
            { provider: { contains: query } },
            { contractNumber: { contains: query } },
            { notes: { contains: query } },
          ],
        },
        select: CONTRACT_SELECT,
        orderBy: { endDate: "asc" },
      });
      return textResult(contracts.map(serializeContract));
    },
  );

  server.registerTool(
    "upcoming_renewals",
    {
      title: "Upcoming renewals",
      description: "Active contracts ending within N days (default 30), soonest first.",
      inputSchema: { withinDays: z.number().int().positive().max(3650).optional() },
    },
    async ({ withinDays }) => {
      const horizon = withinDays ?? 30;
      const contracts = await prisma.contract.findMany({
        where: { status: "ACTIVE", endDate: { not: null } },
        select: CONTRACT_SELECT,
      });
      const upcoming = contracts
        .map(serializeContract)
        .filter((c) => c.daysUntilEnd != null && c.daysUntilEnd >= 0 && c.daysUntilEnd <= horizon)
        .sort((a, b) => (a.daysUntilEnd as number) - (b.daysUntilEnd as number));
      return textResult(upcoming);
    },
  );

  server.registerTool(
    "spend_summary",
    {
      title: "Spend summary",
      description:
        "Estimated total and per-category monthly spend across active contracts " +
        "(one-off charges excluded, figures are summed as-is regardless of currency).",
    },
    async () => {
      const active = await prisma.contract.findMany({
        where: { status: "ACTIVE" },
        select: { category: true, cost: true, billingFrequency: true },
      });

      let total = 0;
      const byCategory: Record<string, number> = {};
      for (const contract of active) {
        const monthly = monthlyEquivalent(contract.cost, contract.billingFrequency);
        total += monthly;
        const label = CATEGORY_LABELS[contract.category] ?? contract.category;
        byCategory[label] = (byCategory[label] ?? 0) + monthly;
      }

      return textResult({
        estimatedMonthlySpendTotal: Math.round(total * 100) / 100,
        byCategory: Object.fromEntries(
          Object.entries(byCategory).map(([label, amount]) => [
            label,
            Math.round(amount * 100) / 100,
          ]),
        ),
      });
    },
  );

  server.registerTool(
    "list_products",
    {
      title: "List products",
      description:
        "List tracked products/purchases and their warranty status, optionally filtered by " +
        "a search term over description/manufacturer/model/vendor.",
      inputSchema: { query: z.string().min(1).optional() },
    },
    async ({ query }) => textResult(await queryProducts(query)),
  );

  if (enabledModules.has("TRAVEL")) {
    server.registerTool(
      "list_trips",
      {
        title: "List trips",
        description: "List trips with their segment count, optionally only ones that haven't ended yet.",
        inputSchema: { upcomingOnly: z.boolean().optional() },
      },
      async ({ upcomingOnly }) => textResult(await queryTrips(upcomingOnly)),
    );
  }

  if (enabledModules.has("VEHICLES")) {
    server.registerTool(
      "list_vehicles",
      {
        title: "List vehicles",
        description:
          "List vehicles with registration/insurance expiry, optionally only ones needing " +
          "attention (expiring within 30 days or already expired).",
        inputSchema: { attentionOnly: z.boolean().optional() },
      },
      async ({ attentionOnly }) => textResult(await queryVehicles(attentionOnly)),
    );
  }

  if (enabledModules.has("HOME")) {
    server.registerTool(
      "list_properties",
      {
        title: "List properties",
        description:
          "List properties with rental status, the current tenant/weekly rent if rented, " +
          "and the most recent valuation.",
      },
      async () => textResult(await queryProperties()),
    );
  }

  if (enabledModules.has("INVENTORY")) {
    server.registerTool(
      "list_inventory_items",
      {
        title: "List inventory items",
        description:
          "List catalogued household items/valuables, optionally filtered by a search term " +
          "over label/brand/model.",
        inputSchema: { query: z.string().min(1).optional() },
      },
      async ({ query }) => textResult(await queryInventoryItems(query)),
    );
  }

  if (enabledModules.has("WEALTH")) {
    server.registerTool(
      "net_worth",
      {
        title: "Net worth",
        description:
          "The household's net worth: share/crypto portfolio value, property value, and " +
          "inventory value, with per-holding gain/loss.",
      },
      async () => textResult(await getNetWorth(enabledModules)),
    );
  }

  return server;
}
