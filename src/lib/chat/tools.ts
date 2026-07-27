import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { CONTRACT_CATEGORIES, CONTRACT_STATUSES } from "@/lib/validation/contract";
import { CATEGORY_LABELS, daysUntil, monthlyEquivalent } from "@/lib/utils";
import { getNetWorth } from "@/lib/wealth";
import {
  iso,
  queryInventoryItems,
  queryProducts,
  queryProperties,
  queryTrips,
  queryVehicles,
} from "@/lib/domainQueries";
import type { ModuleKey } from "@/lib/modules/registry";
import type { ToolDefinition } from "@/lib/ai/chat/types";

export interface ToolContext {
  userId: string;
  enabledModules: Set<ModuleKey>;
}

interface RegisteredTool {
  definition: ToolDefinition;
  // Omitted for the always-on tools (contracts/products aren't module-gated
  // — see CLAUDE.md); present tools are only offered to the model, and only
  // runnable, while that module is enabled.
  moduleKey?: ModuleKey;
  run: (rawInput: unknown, ctx: ToolContext) => Promise<unknown>;
}

function defineTool<T>(spec: {
  name: string;
  description: string;
  inputSchema: ToolDefinition["inputSchema"];
  moduleKey?: ModuleKey;
  schema: z.ZodType<T>;
  run: (input: T, ctx: ToolContext) => Promise<unknown>;
}): RegisteredTool {
  return {
    definition: {
      name: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema,
    },
    moduleKey: spec.moduleKey,
    run: async (rawInput, ctx) => spec.run(spec.schema.parse(rawInput ?? {}), ctx),
  };
}

// ─── Contracts (always-on) ─────────────────────────────────────────────────
// Same field allowlist and household-wide (no createdById filter) approach
// as src/lib/mcp/server.ts's tools — everyone in the household sees the
// same contracts, matching CLAUDE.md's stated data model.

const CONTRACT_SELECT = {
  id: true,
  title: true,
  category: true,
  provider: true,
  contractNumber: true,
  startDate: true,
  endDate: true,
  renewalType: true,
  cost: true,
  currency: true,
  billingFrequency: true,
  status: true,
  notes: true,
  isTaxDeductible: true,
} as const;

interface ContractRow {
  startDate: Date | null;
  endDate: Date | null;
  cost: number | null;
  billingFrequency: string | null;
  [key: string]: unknown;
}

function serializeContract<T extends ContractRow>(contract: T) {
  return {
    ...contract,
    startDate: iso(contract.startDate),
    endDate: iso(contract.endDate),
    daysUntilEnd: daysUntil(contract.endDate),
    estimatedMonthlySpend:
      Math.round(monthlyEquivalent(contract.cost, contract.billingFrequency) * 100) / 100,
  };
}

const listContractsTool = defineTool({
  name: "list_contracts",
  description:
    "List household contracts (rentals, insurance, subscriptions, loans, utilities, warranties, etc), optionally filtered by status and/or category.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: CONTRACT_STATUSES, description: "Filter by status." },
      category: { type: "string", enum: CONTRACT_CATEGORIES, description: "Filter by category." },
    },
  },
  schema: z.object({
    status: z.enum(CONTRACT_STATUSES).optional(),
    category: z.enum(CONTRACT_CATEGORIES).optional(),
  }),
  run: async ({ status, category }) => {
    const contracts = await prisma.contract.findMany({
      where: { ...(status && { status }), ...(category && { category }) },
      select: CONTRACT_SELECT,
      orderBy: { endDate: "asc" },
    });
    return contracts.map(serializeContract);
  },
});

const searchContractsTool = defineTool({
  name: "search_contracts",
  description: "Search contracts by title, provider, contract number, or notes.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", description: "Search text." } },
    required: ["query"],
  },
  schema: z.object({ query: z.string().min(1) }),
  run: async ({ query }) => {
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
    return contracts.map(serializeContract);
  },
});

const upcomingRenewalsTool = defineTool({
  name: "upcoming_renewals",
  description: "Active contracts ending within N days (default 30), soonest first.",
  inputSchema: {
    type: "object",
    properties: {
      withinDays: { type: "number", description: "Horizon in days. Defaults to 30." },
    },
  },
  schema: z.object({ withinDays: z.number().int().positive().max(3650).optional() }),
  run: async ({ withinDays }) => {
    const horizon = withinDays ?? 30;
    const contracts = await prisma.contract.findMany({
      where: { status: "ACTIVE", endDate: { not: null } },
      select: CONTRACT_SELECT,
    });
    return contracts
      .map(serializeContract)
      .filter((c) => c.daysUntilEnd != null && c.daysUntilEnd >= 0 && c.daysUntilEnd <= horizon)
      .sort((a, b) => (a.daysUntilEnd as number) - (b.daysUntilEnd as number));
  },
});

const spendSummaryTool = defineTool({
  name: "spend_summary",
  description:
    "Estimated total and per-category monthly spend across active contracts (one-off charges excluded, figures summed as-is regardless of currency).",
  inputSchema: { type: "object", properties: {} },
  schema: z.object({}),
  run: async () => {
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
    return {
      estimatedMonthlySpendTotal: Math.round(total * 100) / 100,
      byCategory: Object.fromEntries(
        Object.entries(byCategory).map(([label, amount]) => [
          label,
          Math.round(amount * 100) / 100,
        ]),
      ),
    };
  },
});

// ─── Products / warranties (always-on) ─────────────────────────────────────

const listProductsTool = defineTool({
  name: "list_products",
  description:
    "List tracked products/purchases and their warranty status, optionally filtered by a search term over description/manufacturer/model/vendor.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", description: "Optional search text." } },
  },
  schema: z.object({ query: z.string().min(1).optional() }),
  run: async ({ query }) => queryProducts(query),
});

// ─── Travel (module: TRAVEL) ────────────────────────────────────────────────

const listTripsTool = defineTool({
  name: "list_trips",
  description: "List trips with their segment count, optionally only ones that haven't ended yet.",
  moduleKey: "TRAVEL",
  inputSchema: {
    type: "object",
    properties: {
      upcomingOnly: { type: "boolean", description: "Only include trips ending today or later." },
    },
  },
  schema: z.object({ upcomingOnly: z.boolean().optional() }),
  run: async ({ upcomingOnly }) => queryTrips(upcomingOnly),
});

// ─── Vehicles (module: VEHICLES) ────────────────────────────────────────────

const listVehiclesTool = defineTool({
  name: "list_vehicles",
  description:
    "List vehicles with registration/insurance expiry, optionally only ones needing attention (expiring within 30 days or already expired).",
  moduleKey: "VEHICLES",
  inputSchema: {
    type: "object",
    properties: {
      attentionOnly: {
        type: "boolean",
        description: "Only include vehicles with rego or insurance expiring within 30 days.",
      },
    },
  },
  schema: z.object({ attentionOnly: z.boolean().optional() }),
  run: async ({ attentionOnly }) => queryVehicles(attentionOnly),
});

// ─── Home (module: HOME) ────────────────────────────────────────────────────

const listPropertiesTool = defineTool({
  name: "list_properties",
  description:
    "List properties with rental status, the current tenant/weekly rent if rented, and the most recent valuation.",
  moduleKey: "HOME",
  inputSchema: { type: "object", properties: {} },
  schema: z.object({}),
  run: async () => queryProperties(),
});

// ─── Inventory (module: INVENTORY) ──────────────────────────────────────────

const listInventoryItemsTool = defineTool({
  name: "list_inventory_items",
  description:
    "List catalogued household items/valuables, optionally filtered by a search term over label/brand/model.",
  moduleKey: "INVENTORY",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", description: "Optional search text." } },
  },
  schema: z.object({ query: z.string().min(1).optional() }),
  run: async ({ query }) => queryInventoryItems(query),
});

// ─── Wealth (module: WEALTH) ─────────────────────────────────────────────────
const netWorthTool = defineTool({
  name: "net_worth",
  description:
    "The household's net worth: share/crypto portfolio value, property value, and inventory value, with per-holding gain/loss.",
  moduleKey: "WEALTH",
  inputSchema: { type: "object", properties: {} },
  schema: z.object({}),
  run: async (_input, ctx) => getNetWorth(ctx.enabledModules),
});

const ALL_TOOLS: RegisteredTool[] = [
  listContractsTool,
  searchContractsTool,
  upcomingRenewalsTool,
  spendSummaryTool,
  listProductsTool,
  listTripsTool,
  listVehiclesTool,
  listPropertiesTool,
  listInventoryItemsTool,
  netWorthTool,
];

export function getAvailableTools(enabledModules: Set<ModuleKey>): ToolDefinition[] {
  return ALL_TOOLS.filter((t) => !t.moduleKey || enabledModules.has(t.moduleKey)).map(
    (t) => t.definition,
  );
}

// Executes a tool call by name, returning a JSON string suitable for a
// "tool" role ChatTurn. Never throws — validation/runtime errors are
// returned as a JSON error payload so the model can see what went wrong
// and try again, rather than the whole request failing.
export async function runTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<string> {
  const tool = ALL_TOOLS.find((t) => t.definition.name === name);
  if (!tool) {
    return JSON.stringify({ error: `Unknown tool "${name}".` });
  }
  if (tool.moduleKey && !ctx.enabledModules.has(tool.moduleKey)) {
    return JSON.stringify({ error: `The ${tool.moduleKey} module is not enabled.` });
  }
  try {
    const result = await tool.run(rawInput, ctx);
    return JSON.stringify(result);
  } catch (err) {
    const message = err instanceof z.ZodError ? "Invalid arguments for this tool." : "Tool failed.";
    return JSON.stringify({ error: message });
  }
}
