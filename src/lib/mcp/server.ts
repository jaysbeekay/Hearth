import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CONTRACT_CATEGORIES, CONTRACT_STATUSES } from "@/lib/validation/contract";
import {
  DEFAULT_DUE_HORIZON_DAYS,
  TOOL_DESCRIPTIONS,
  currencyCodeSchema,
  defaultSpendCurrency,
  getContract,
  queryContracts,
  queryInventoryItems,
  queryProducts,
  queryProperties,
  queryTrips,
  queryVehicles,
  searchContracts,
  spendSummary,
  upcomingRenewals,
  whatsDue,
} from "@/lib/domainQueries";
import { getEnabledModuleKeys } from "@/lib/modules/enablement";
import { getNetWorth } from "@/lib/wealth";

// Every tool here is read-only: a thin wrapper over src/lib/domainQueries.ts,
// which the Assistant's read tools share (#394). Never add a write tool, and
// never return credentials or document file contents.

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

const withinDaysInput = {
  withinDays: z
    .number()
    .int()
    .positive()
    .max(3650)
    .optional()
    .describe(`Horizon in days. Defaults to ${DEFAULT_DUE_HORIZON_DAYS}.`),
};

export async function createMcpServer() {
  const enabledModules = await getEnabledModuleKeys();

  const server = new McpServer(
    { name: "hearth", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Read-only tools over a household's Contracts (insurance, phone plans, leases, loans, " +
        "subscriptions and so on), Items' Warranties, what's Due, and — depending on which " +
        "optional modules this household has enabled — travel, vehicles, home/properties, " +
        "inventory, and net worth. These never modify data and never expose account " +
        "credentials or uploaded document contents. Only tools for enabled modules are " +
        "listed; if a household disables a module later, the corresponding tool disappears " +
        "on the next connection.",
    },
  );

  server.registerTool(
    "list_contracts",
    {
      title: "List contracts",
      description: TOOL_DESCRIPTIONS.listContracts,
      inputSchema: {
        status: z.enum(CONTRACT_STATUSES).optional(),
        category: z.enum(CONTRACT_CATEGORIES).optional(),
      },
    },
    async ({ status, category }) => textResult(await queryContracts({ status, category })),
  );

  server.registerTool(
    "get_contract",
    {
      title: "Get contract",
      description: TOOL_DESCRIPTIONS.getContract,
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => textResult((await getContract(id)) ?? { error: `No contract with id "${id}"` }),
  );

  server.registerTool(
    "search_contracts",
    {
      title: "Search contracts",
      description: TOOL_DESCRIPTIONS.searchContracts,
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => textResult(await searchContracts(query)),
  );

  server.registerTool(
    "upcoming_renewals",
    {
      title: "Upcoming renewals",
      description: TOOL_DESCRIPTIONS.upcomingRenewals,
      inputSchema: withinDaysInput,
    },
    async ({ withinDays }) => textResult(await upcomingRenewals(withinDays)),
  );

  server.registerTool(
    "spend_summary",
    {
      title: "Spend summary",
      description: TOOL_DESCRIPTIONS.spendSummary,
      inputSchema: {
        currency: currencyCodeSchema
          .optional()
          .describe("ISO 4217 currency code to convert to, such as AUD. Defaults to the first admin's preferred currency."),
      },
    },
    async ({ currency }) => textResult(await spendSummary(currency ?? (await defaultSpendCurrency()))),
  );

  server.registerTool(
    "whats_due",
    {
      title: "What's due",
      description: TOOL_DESCRIPTIONS.whatsDue,
      inputSchema: withinDaysInput,
    },
    async ({ withinDays }) => textResult(await whatsDue(enabledModules, withinDays)),
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
          "attention (expiring within 30 days or already expired). Archived vehicles (no longer owned) " +
          "are left out.",
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
          "and the most recent valuation. Archived properties (no longer owned) are left out.",
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
