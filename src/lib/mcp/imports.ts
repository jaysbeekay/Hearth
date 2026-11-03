import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { McpImportKind } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import {
  BILLING_FREQUENCIES,
  CONTRACT_CATEGORIES,
  CONTRACT_STATUSES,
  RENEWAL_TYPES,
  contractSchema,
} from "@/lib/validation/contract";
import { productSchema } from "@/lib/validation/product";
import { INVENTORY_ITEM_CATEGORIES, inventoryItemSchema } from "@/lib/validation/inventory";
import { createContractCommand } from "@/lib/commands/contracts";
import { createProductCommand } from "@/lib/commands/products";
import { createInventoryItemCommand } from "@/lib/commands/inventory";

// Data import over MCP (#529). An agent never writes a record: each
// propose_import_* tool validates its input against the same Zod schema as
// the matching form and stores a pending McpImportProposal. A household
// member then approves or rejects it in Documents → Imports; approval
// re-validates and writes through the kind's record command, so Due,
// reminders and revalidation behave exactly as for a record made in the UI.
//
// Only tokens listed in MCP_IMPORT_LABELS are offered these tools. Record
// links (property, vehicle, warranty ids) are left out on purpose: an agent
// shouldn't be trusted to name existing records, and a link can be added in
// the UI after approval.

/** Most pending proposals the queue holds, so a looping agent can't flood it. */
export const MAX_PENDING_IMPORTS = 200;

// What the agent sees. Plain JSON types (dates as YYYY-MM-DD strings) so the
// SDK can describe them as JSON Schema; the real schemas below re-validate.
const optionalText = (max: number) => z.string().max(max).optional();
const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional();
const optionalAmount = z.number().min(0).optional();
const currency = z.string().min(1).max(10).optional().describe("ISO 4217 code, e.g. AUD");

export const IMPORT_TOOL_INPUTS = {
  CONTRACT: {
    title: z.string().min(1).max(200),
    category: z.enum(CONTRACT_CATEGORIES),
    provider: z.string().min(1).max(200),
    renewalType: z.enum(RENEWAL_TYPES),
    contractNumber: optionalText(100),
    startDate: optionalDate,
    endDate: optionalDate,
    noticePeriodDays: z.number().int().min(0).max(3650).optional(),
    cost: optionalAmount,
    currency,
    billingFrequency: z.enum(BILLING_FREQUENCIES).optional(),
    status: z.enum(CONTRACT_STATUSES).optional(),
    contactName: optionalText(200),
    contactPhone: optionalText(50),
    contactEmail: optionalText(200),
    notes: optionalText(5000),
    isTaxDeductible: z.boolean().optional(),
  },
  PRODUCT: {
    description: z.string().min(1).max(200),
    manufacturer: optionalText(200),
    model: optionalText(200),
    vendor: optionalText(200),
    serialNumber: optionalText(100),
    barcode: optionalText(64),
    purchaseDate: optionalDate,
    warrantyEndDate: optionalDate,
    price: optionalAmount,
    currency,
    notes: optionalText(5000),
  },
  INVENTORY_ITEM: {
    label: z.string().min(1).max(200),
    category: z.enum(INVENTORY_ITEM_CATEGORIES).optional(),
    brand: optionalText(100),
    model: optionalText(100),
    serialNumber: optionalText(100),
    purchaseDate: optionalDate,
    purchasePrice: optionalAmount,
    currency,
    location: optionalText(100),
    notes: optionalText(5000),
  },
} as const;

const LINK_FIELDS = ["propertyId", "vehicleId", "warrantyProductId"] as const;

function withoutLinks(input: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...input };
  for (const key of LINK_FIELDS) delete copy[key];
  return copy;
}

// The forms' own schemas: the single source of truth for what a record may hold.
function validate(kind: McpImportKind, input: Record<string, unknown>) {
  const data = withoutLinks(input);
  switch (kind) {
    case "CONTRACT":
      return contractSchema.safeParse(data);
    case "PRODUCT":
      return productSchema.safeParse(data);
    case "INVENTORY_ITEM":
      return inventoryItemSchema.safeParse(data);
  }
}

function issueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid input.";
  const field = issue.path.join(".");
  return field ? `${field}: ${issue.message}` : issue.message;
}

function summarize(kind: McpImportKind, data: Record<string, unknown>): string {
  const parts =
    kind === "CONTRACT"
      ? [data.title, data.provider]
      : kind === "PRODUCT"
        ? [data.description, data.manufacturer]
        : [data.label, data.brand];
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" · ").slice(0, 200);
}

export type ProposeResult =
  | { ok: true; proposalId: string }
  | { ok: false; error: string };

export async function proposeImport(
  kind: McpImportKind,
  input: Record<string, unknown>,
  tokenLabel: string,
): Promise<ProposeResult> {
  const parsed = validate(kind, input);
  if (!parsed.success) return { ok: false, error: issueMessage(parsed.error) };

  const full = {
    ok: false as const,
    error: `The import queue is full (${MAX_PENDING_IMPORTS} pending). Ask a household member to review it in Hearth first.`,
  };
  if ((await prisma.mcpImportProposal.count({ where: { status: "PENDING" } })) >= MAX_PENDING_IMPORTS) return full;

  const data = parsed.data as Record<string, unknown>;
  const proposal = await prisma.mcpImportProposal.create({
    data: { kind, data: JSON.stringify(data), summary: summarize(kind, data), tokenLabel },
  });
  // Count again now the row exists, so proposals racing in from several
  // tokens can't push the queue past the cap: whichever lands over it is
  // withdrawn (at worst two racers both back off, never both stay).
  const ahead = await prisma.mcpImportProposal.count({
    where: { status: "PENDING", OR: [{ createdAt: { lt: proposal.createdAt } }, { createdAt: proposal.createdAt, id: { lt: proposal.id } }] },
  });
  if (ahead >= MAX_PENDING_IMPORTS) {
    await prisma.mcpImportProposal.deleteMany({ where: { id: proposal.id, status: "PENDING" } });
    return full;
  }
  revalidatePath("/documents/imports");
  return { ok: true, proposalId: proposal.id };
}

export class ImportReviewError extends Error {}

/**
 * Approves one pending proposal: re-validates the stored data with the form
 * schema and writes it through the kind's record command. The proposal is
 * claimed (PENDING → APPROVED, with the new record's id) inside the record's
 * own transaction, so the record and the approval commit together or not at
 * all, and two reviewers can't both create it.
 */
export async function approveImportCommand(id: string, actorId: string): Promise<{ recordId: string }> {
  const proposal = await prisma.mcpImportProposal.findUnique({ where: { id } });
  if (!proposal) throw new ImportReviewError("That import no longer exists.");
  if (proposal.status !== "PENDING") throw new ImportReviewError("That import has already been reviewed.");

  let stored: unknown;
  try {
    stored = JSON.parse(proposal.data);
  } catch {
    throw new ImportReviewError("That import's data is unreadable. Reject it.");
  }
  const parsed = validate(proposal.kind, (stored ?? {}) as Record<string, unknown>);
  if (!parsed.success) throw new ImportReviewError(`No longer valid: ${issueMessage(parsed.error)}`);

  const claim = async (tx: Prisma.TransactionClient, created: { id: string }) => {
    const claimed = await tx.mcpImportProposal.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "APPROVED", recordId: created.id, reviewedById: actorId, reviewedAt: new Date() },
    });
    if (claimed.count !== 1) throw new ImportReviewError("That import has already been reviewed.");
  };

  let recordId: string;
  switch (proposal.kind) {
    case "CONTRACT":
      recordId = (await createContractCommand(parsed.data as z.infer<typeof contractSchema>, actorId, undefined, claim)).id;
      break;
    case "PRODUCT":
      recordId = (await createProductCommand(parsed.data as z.infer<typeof productSchema>, actorId, undefined, claim)).id;
      break;
    case "INVENTORY_ITEM":
      recordId = (await createInventoryItemCommand(parsed.data as z.infer<typeof inventoryItemSchema>, actorId, claim)).id;
      break;
  }
  revalidatePath("/documents/imports");
  return { recordId };
}

export async function rejectImportCommand(id: string, actorId: string): Promise<void> {
  const rejected = await prisma.mcpImportProposal.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "REJECTED", reviewedById: actorId, reviewedAt: new Date() },
  });
  if (rejected.count !== 1) throw new ImportReviewError("That import has already been reviewed.");
  revalidatePath("/documents/imports");
}

const norm = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");

export interface DuplicateHint {
  href: string;
  label: string;
}

/**
 * Likely existing records for each pending proposal, matched on an
 * identifier (contract number, serial number) or on name plus maker. Only a
 * hint for the reviewer: nothing is merged.
 *
 * One pass over each kind's live records (narrow columns only), looking each
 * record's keys up in maps built from the proposals, so the cost is
 * O(records + proposals) rather than records × proposals.
 */
export async function findImportDuplicates(
  proposals: { id: string; kind: McpImportKind; data: string }[],
): Promise<Map<string, DuplicateHint[]>> {
  // Normalised key → ids of the proposals that carry it.
  const index = new Map<string, string[]>();
  const add = (key: string, id: string) => {
    const ids = index.get(key);
    if (ids) ids.push(id);
    else index.set(key, [id]);
  };
  const kinds = new Set<McpImportKind>();
  for (const proposal of proposals) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(proposal.data) as Record<string, unknown>;
    } catch {
      continue;
    }
    kinds.add(proposal.kind);
    for (const key of matchKeys(proposal.kind, data)) add(key, proposal.id);
  }

  const result = new Map<string, DuplicateHint[]>();
  const hint = (keys: string[], dup: DuplicateHint) => {
    const ids = new Set(keys.flatMap((key) => index.get(key) ?? []));
    for (const id of ids) {
      const hints = result.get(id) ?? [];
      if (hints.length < MAX_DUPLICATE_HINTS) hints.push(dup);
      result.set(id, hints);
    }
  };

  if (kinds.has("CONTRACT")) {
    const contracts = await prisma.contract.findMany({
      where: { deletedAt: null },
      select: { id: true, title: true, provider: true, contractNumber: true },
    });
    for (const c of contracts) {
      hint(matchKeys("CONTRACT", c), { href: `/contracts/${c.id}`, label: `${c.title} · ${c.provider}` });
    }
  }
  if (kinds.has("PRODUCT")) {
    const products = await prisma.product.findMany({
      where: { deletedAt: null },
      select: { id: true, description: true, manufacturer: true, model: true, serialNumber: true },
    });
    for (const p of products) hint(matchKeys("PRODUCT", p), { href: `/products/${p.id}`, label: p.description });
  }
  if (kinds.has("INVENTORY_ITEM")) {
    const items = await prisma.inventoryItem.findMany({
      where: { deletedAt: null },
      select: { id: true, label: true, brand: true, model: true, serialNumber: true },
    });
    for (const i of items) hint(matchKeys("INVENTORY_ITEM", i), { href: `/inventory/${i.id}`, label: i.label });
  }
  return result;
}

const MAX_DUPLICATE_HINTS = 5;

// The keys a record or proposal matches on: its identifier, and its name
// plus maker (plus model for products and items). Matching keys = likely
// duplicate. Kind-prefixed so a contract never matches a product.
function matchKeys(kind: McpImportKind, data: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const key = (...parts: unknown[]) => `${kind}\u0000${parts.map(norm).join("\u0000")}`;
  if (kind === "CONTRACT") {
    if (norm(data.contractNumber)) keys.push(key("number", data.contractNumber));
    keys.push(key("name", data.title, data.provider));
  } else {
    if (norm(data.serialNumber)) keys.push(key("serial", data.serialNumber));
    const name = kind === "PRODUCT" ? data.description : data.label;
    const maker = kind === "PRODUCT" ? data.manufacturer : data.brand;
    keys.push(key("name", name, maker, data.model));
  }
  return keys;
}

/** For the Documents tabs: how many proposals are waiting. */
export async function pendingImportCount(): Promise<number> {
  return prisma.mcpImportProposal.count({ where: { status: "PENDING" } });
}
