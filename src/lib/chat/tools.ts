import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  CONTRACT_CATEGORIES,
  CONTRACT_STATUSES,
  RENEWAL_TYPES,
  BILLING_FREQUENCIES,
  contractSchema,
  contractPatchSchema,
} from "@/lib/validation/contract";
import { productSchema, productPatchSchema } from "@/lib/validation/product";
import { parseNamedPatch } from "@/lib/validation/namedPatch";
import { linkedRecordError, newLinks, type RecordLinks } from "@/lib/commands/links";
import { getNetWorth } from "@/lib/wealth";
import {
  DEFAULT_DUE_HORIZON_DAYS,
  TOOL_DESCRIPTIONS,
  contractProposalBasis,
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
import type { ModuleKey } from "@/lib/modules/registry";
import type { ToolDefinition } from "@/lib/ai/chat/types";
import type { Role } from "@/generated/prisma/enums";

export interface ToolContext {
  userId: string;
  role: Role;
  enabledModules: Set<ModuleKey>;
}

interface RegisteredTool {
  definition: ToolDefinition;
  // Omitted for the always-on tools (contracts/products aren't module-gated
  // — see CLAUDE.md); present tools are only offered to the model, and only
  // runnable, while that module is enabled.
  moduleKey?: ModuleKey;
  // Guarded write ("propose_*") tools — never offered to or runnable by a
  // READONLY-role user, matching every other write path in the app. These
  // tools never write to Prisma themselves (see the "Guarded writes" section
  // below); the actual write happens only after the user confirms the
  // proposal in the UI, via the *FromAssistant server actions.
  isWrite?: boolean;
  run: (rawInput: unknown, ctx: ToolContext) => Promise<unknown>;
}

function defineTool<T>(spec: {
  name: string;
  description: string;
  inputSchema: ToolDefinition["inputSchema"];
  moduleKey?: ModuleKey;
  isWrite?: boolean;
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
    isWrite: spec.isWrite,
    run: async (rawInput, ctx) => spec.run(spec.schema.parse(rawInput ?? {}), ctx),
  };
}

// ─── Contracts and what's Due (always-on) ──────────────────────────────────
// Thin wrappers over src/lib/domainQueries.ts, which the MCP server's tools
// share (#394): the same queries, the same Contract shape and the same
// descriptions, so chat and MCP give the same answer.

const withinDaysProperty = {
  withinDays: {
    type: "number",
    description: `Horizon in days. Defaults to ${DEFAULT_DUE_HORIZON_DAYS}.`,
  },
};
const withinDaysSchema = z.object({ withinDays: z.number().int().positive().max(3650).optional() });

const listContractsTool = defineTool({
  name: "list_contracts",
  description: TOOL_DESCRIPTIONS.listContracts,
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
  run: async ({ status, category }) => queryContracts({ status, category }),
});

const getContractTool = defineTool({
  name: "get_contract",
  description: TOOL_DESCRIPTIONS.getContract,
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", description: "Contract id." } },
    required: ["id"],
  },
  schema: z.object({ id: z.string().min(1) }),
  run: async ({ id }) => (await getContract(id)) ?? { error: `No contract with id "${id}"` },
});

const searchContractsTool = defineTool({
  name: "search_contracts",
  description: TOOL_DESCRIPTIONS.searchContracts,
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", description: "Search text." } },
    required: ["query"],
  },
  schema: z.object({ query: z.string().min(1) }),
  run: async ({ query }) => searchContracts(query),
});

const upcomingRenewalsTool = defineTool({
  name: "upcoming_renewals",
  description: TOOL_DESCRIPTIONS.upcomingRenewals,
  inputSchema: { type: "object", properties: withinDaysProperty },
  schema: withinDaysSchema,
  run: async ({ withinDays }) => upcomingRenewals(withinDays),
});

const spendSummaryTool = defineTool({
  name: "spend_summary",
  description: TOOL_DESCRIPTIONS.spendSummary,
  inputSchema: {
    type: "object",
    properties: {
      currency: {
        type: "string",
        description: "ISO 4217 currency code to convert to, such as AUD. Defaults to your preferred currency.",
      },
    },
  },
  schema: z.object({ currency: currencyCodeSchema.optional() }),
  run: async ({ currency }, ctx) => spendSummary(currency ?? (await defaultSpendCurrency(ctx.userId))),
});

const whatsDueTool = defineTool({
  name: "whats_due",
  description: TOOL_DESCRIPTIONS.whatsDue,
  inputSchema: { type: "object", properties: withinDaysProperty },
  schema: withinDaysSchema,
  run: async ({ withinDays }, ctx) => whatsDue(ctx.enabledModules, withinDays),
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
    "List vehicles with registration/insurance expiry, optionally only ones needing attention (expiring within 30 days or already expired). Archived vehicles (no longer owned) are left out.",
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
    "List properties with rental status, the current tenant/weekly rent if rented, and the most recent valuation. Archived properties (no longer owned) are left out.",
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

// ─── Guarded writes (create/update contracts & products) ───────────────────
// These tools never write to Prisma — they validate the model's proposed
// fields against the same Zod schemas the real forms use (contractSchema /
// productSchema for a create; their .partial() patch schemas for an update,
// keeping only the fields the model named) and echo back the validated data.
// An update also reads the record's name and dates, and any linked
// record's name, for the confirmation card. src/app/api/chat/route.ts
// detects a successful proposal and emits it to the client as a distinct
// "proposed_action" SSE event; the actual write only happens once the user
// reviews and explicitly confirms it in the UI, via createContractFromAssistant
// / updateContractFromAssistant / their product counterparts — never directly
// from this tool call. Excluded entirely for READONLY-role users (see isWrite
// below), same as every other write path in the app.
//
// Trips/vehicles/properties/inventory aren't covered yet — this establishes
// the pattern for contracts and products (the two always-on domains); extending
// it to the module-gated domains is straightforward follow-up work.

const CONTRACT_WRITE_PROPERTIES = {
  title: { type: "string", description: "Short title, e.g. 'Apartment lease - 12 Main St'." },
  category: { type: "string", enum: CONTRACT_CATEGORIES },
  provider: { type: "string", description: "Provider or company name." },
  contractNumber: { type: "string" },
  startDate: { type: "string", description: "ISO date, e.g. 2026-01-15." },
  endDate: { type: "string", description: "ISO date, e.g. 2026-01-15." },
  renewalType: { type: "string", enum: RENEWAL_TYPES },
  noticePeriodDays: { type: "number" },
  cost: { type: "number" },
  currency: { type: "string", description: "3-letter currency code, e.g. AUD." },
  billingFrequency: { type: "string", enum: BILLING_FREQUENCIES },
  status: { type: "string", enum: CONTRACT_STATUSES },
  contactName: { type: "string" },
  contactPhone: { type: "string" },
  contactEmail: { type: "string" },
  notes: { type: "string" },
  reminderDaysBefore: { type: "string", description: "Comma-separated days, e.g. '30,14,7,1'." },
  isTaxDeductible: { type: "boolean" },
} as const;

// The card shows a linked Property or Vehicle by name, not its id. Checks
// the link first (missing, in Trash, or its module off), so a proposal the
// confirm would refuse is refused now instead. For an update, `existing` is
// the record's current links: as in the commands, only a link the update
// newly sets is checked, and one the record already has is kept (#447).
async function linkDisplay(
  data: { propertyId?: string; vehicleId?: string },
  existing?: RecordLinks,
): Promise<{ error: string } | { displayValues?: Record<string, string> }> {
  const linkError = await linkedRecordError(newLinks(data, existing));
  if (linkError) return { error: linkError };
  const displayValues: Record<string, string> = {};
  if (data.propertyId) {
    const property = await prisma.property.findUnique({ where: { id: data.propertyId }, select: { label: true } });
    if (property) displayValues.propertyId = property.label;
  }
  if (data.vehicleId) {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: data.vehicleId }, select: { label: true } });
    if (vehicle) displayValues.vehicleId = vehicle.label;
  }
  return Object.keys(displayValues).length > 0 ? { displayValues } : {};
}

// A date moved on its own is checked against the saved other date here, so
// the user isn't shown a card whose confirm the command would refuse.
function datesOutOfOrder(start: Date | null | undefined, end: Date | null | undefined) {
  return Boolean(start && end && end < start);
}

const proposeCreateContractTool = defineTool({
  name: "propose_create_contract",
  description:
    "Propose creating a new contract. This does not save anything by itself — it validates the " +
    "fields and shows the user a confirmation card; the contract is only created if they approve it.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: CONTRACT_WRITE_PROPERTIES,
    required: ["title", "category", "provider", "renewalType"],
  },
  schema: z.record(z.string(), z.unknown()),
  run: async (input) => {
    const parsed = contractSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
    const links = await linkDisplay(parsed.data);
    if ("error" in links) return links;
    return { proposed: true, entity: "contract", operation: "create", data: parsed.data, ...links };
  },
});

const proposeUpdateContractTool = defineTool({
  name: "propose_update_contract",
  description:
    "Propose changes to an existing contract (id from list_contracts/search_contracts). Include " +
    "only the fields that change; every field left out keeps its current value. Does not save " +
    "anything by itself — shows the user a confirmation card first.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: { contractId: { type: "string" }, ...CONTRACT_WRITE_PROPERTIES },
    required: ["contractId"],
  },
  schema: z.record(z.string(), z.unknown()),
  run: async (input) => {
    const { contractId, ...fields } = input;
    if (typeof contractId !== "string" || !contractId) {
      return { error: "contractId is required." };
    }
    // Only the named fields go into the proposal (#420): the full schema
    // would fill defaults (status, tax-deductible) for the rest.
    const parsed = parseNamedPatch(contractPatchSchema, fields);
    if (!parsed.success) return { error: parsed.error };
    // Read-only lookup, so the card can say which contract it changes.
    const contract = await contractProposalBasis(contractId);
    if (!contract) return { error: "No contract with that id." };
    const { startDate = contract.startDate, endDate = contract.endDate } = parsed.data;
    if (datesOutOfOrder(startDate, endDate)) return { error: "End date can't be before the start date." };
    const links = await linkDisplay(parsed.data, contract);
    if ("error" in links) return links;
    return {
      proposed: true,
      entity: "contract",
      operation: "update",
      entityId: contractId,
      label: contract.title,
      data: parsed.data,
      ...links,
    };
  },
});

const PRODUCT_WRITE_PROPERTIES = {
  description: { type: "string", description: "e.g. '65-inch QLED TV'." },
  manufacturer: { type: "string", description: "Brand, e.g. Samsung." },
  model: { type: "string" },
  vendor: { type: "string", description: "Retailer, e.g. JB Hi-Fi." },
  serialNumber: { type: "string" },
  barcode: { type: "string" },
  purchaseDate: { type: "string", description: "ISO date, e.g. 2026-01-15." },
  warrantyEndDate: { type: "string", description: "ISO date, e.g. 2026-01-15." },
  price: { type: "number" },
  currency: { type: "string", description: "3-letter currency code, e.g. AUD." },
  notes: { type: "string" },
  reminderDaysBefore: { type: "string", description: "Comma-separated days, e.g. '30,14,7,1'." },
} as const;

const proposeCreateProductTool = defineTool({
  name: "propose_create_product",
  description:
    "Propose adding a new product/warranty. This does not save anything by itself — it validates " +
    "the fields and shows the user a confirmation card; the product is only created if they approve it.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: PRODUCT_WRITE_PROPERTIES,
    required: ["description"],
  },
  schema: z.record(z.string(), z.unknown()),
  run: async (input) => {
    const parsed = productSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
    const links = await linkDisplay(parsed.data);
    if ("error" in links) return links;
    return { proposed: true, entity: "product", operation: "create", data: parsed.data, ...links };
  },
});

const proposeUpdateProductTool = defineTool({
  name: "propose_update_product",
  description:
    "Propose changes to an existing product (id from list_products). Include only the fields " +
    "that change; every field left out keeps its current value. Does not save anything by " +
    "itself — shows the user a confirmation card first.",
  isWrite: true,
  inputSchema: {
    type: "object",
    properties: { productId: { type: "string" }, ...PRODUCT_WRITE_PROPERTIES },
    required: ["productId"],
  },
  schema: z.record(z.string(), z.unknown()),
  run: async (input) => {
    const { productId, ...fields } = input;
    if (typeof productId !== "string" || !productId) {
      return { error: "productId is required." };
    }
    // Only the named fields go into the proposal: see propose_update_contract.
    const parsed = parseNamedPatch(productPatchSchema, fields);
    if (!parsed.success) return { error: parsed.error };
    const product = await prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { description: true, purchaseDate: true, warrantyEndDate: true, propertyId: true },
    });
    if (!product) return { error: "No product with that id." };
    const { purchaseDate = product.purchaseDate, warrantyEndDate = product.warrantyEndDate } = parsed.data;
    if (datesOutOfOrder(purchaseDate, warrantyEndDate)) {
      return { error: "Warranty end date can't be before the purchase date." };
    }
    const links = await linkDisplay(parsed.data, product);
    if ("error" in links) return links;
    return {
      proposed: true,
      entity: "product",
      operation: "update",
      entityId: productId,
      label: product.description,
      data: parsed.data,
      ...links,
    };
  },
});

const ALL_TOOLS: RegisteredTool[] = [
  listContractsTool,
  getContractTool,
  searchContractsTool,
  upcomingRenewalsTool,
  spendSummaryTool,
  whatsDueTool,
  listProductsTool,
  listTripsTool,
  listVehiclesTool,
  listPropertiesTool,
  listInventoryItemsTool,
  netWorthTool,
  proposeCreateContractTool,
  proposeUpdateContractTool,
  proposeCreateProductTool,
  proposeUpdateProductTool,
];

export function getAvailableTools(role: Role, enabledModules: Set<ModuleKey>): ToolDefinition[] {
  return ALL_TOOLS.filter(
    (t) => (!t.moduleKey || enabledModules.has(t.moduleKey)) && (!t.isWrite || role !== "READONLY"),
  ).map((t) => t.definition);
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
  if (tool.isWrite && ctx.role === "READONLY") {
    return JSON.stringify({ error: "Your account has read-only access." });
  }
  try {
    const result = await tool.run(rawInput, ctx);
    return JSON.stringify(result);
  } catch (err) {
    const message = err instanceof z.ZodError ? "Invalid arguments for this tool." : "Tool failed.";
    return JSON.stringify({ error: message });
  }
}
