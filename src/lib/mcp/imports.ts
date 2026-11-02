import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { McpImportKind } from "@/generated/prisma/enums";
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

  const pending = await prisma.mcpImportProposal.count({ where: { status: "PENDING" } });
  if (pending >= MAX_PENDING_IMPORTS) {
    return {
      ok: false,
      error: `The import queue is full (${MAX_PENDING_IMPORTS} pending). Ask a household member to review it in Hearth first.`,
    };
  }

  const data = parsed.data as Record<string, unknown>;
  const proposal = await prisma.mcpImportProposal.create({
    data: { kind, data: JSON.stringify(data), summary: summarize(kind, data), tokenLabel },
  });
  revalidatePath("/documents/imports");
  return { ok: true, proposalId: proposal.id };
}

export class ImportReviewError extends Error {}

/**
 * Approves one pending proposal: claims it (so two reviewers can't both
 * create the record), re-validates the stored data with the form schema, and
 * writes it through the kind's record command. If the write fails the claim
 * is released and the proposal stays pending.
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

  const claimed = await prisma.mcpImportProposal.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "APPROVED", reviewedById: actorId, reviewedAt: new Date() },
  });
  if (claimed.count !== 1) throw new ImportReviewError("That import has already been reviewed.");

  let recordId: string;
  try {
    switch (proposal.kind) {
      case "CONTRACT":
        recordId = (await createContractCommand(parsed.data as z.infer<typeof contractSchema>, actorId)).id;
        break;
      case "PRODUCT":
        recordId = (await createProductCommand(parsed.data as z.infer<typeof productSchema>, actorId)).id;
        break;
      case "INVENTORY_ITEM":
        recordId = (await createInventoryItemCommand(parsed.data as z.infer<typeof inventoryItemSchema>, actorId)).id;
        break;
    }
  } catch (error) {
    await prisma.mcpImportProposal.update({
      where: { id },
      data: { status: "PENDING", reviewedById: null, reviewedAt: null },
    });
    throw error;
  }

  await prisma.mcpImportProposal.update({ where: { id }, data: { recordId } });
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
 */
export async function findImportDuplicates(
  proposals: { id: string; kind: McpImportKind; data: string }[],
): Promise<Map<string, DuplicateHint[]>> {
  const kinds = new Set(proposals.map((p) => p.kind));
  const [contracts, products, items] = await Promise.all([
    kinds.has("CONTRACT")
      ? prisma.contract.findMany({
          where: { deletedAt: null },
          select: { id: true, title: true, provider: true, contractNumber: true },
        })
      : [],
    kinds.has("PRODUCT")
      ? prisma.product.findMany({
          where: { deletedAt: null },
          select: { id: true, description: true, manufacturer: true, model: true, serialNumber: true },
        })
      : [],
    kinds.has("INVENTORY_ITEM")
      ? prisma.inventoryItem.findMany({
          where: { deletedAt: null },
          select: { id: true, label: true, brand: true, model: true, serialNumber: true },
        })
      : [],
  ]);

  const result = new Map<string, DuplicateHint[]>();
  for (const proposal of proposals) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(proposal.data) as Record<string, unknown>;
    } catch {
      continue;
    }
    let hints: DuplicateHint[] = [];
    if (proposal.kind === "CONTRACT") {
      hints = contracts
        .filter(
          (c) =>
            (norm(data.contractNumber) && norm(c.contractNumber) === norm(data.contractNumber)) ||
            (norm(c.title) === norm(data.title) && norm(c.provider) === norm(data.provider)),
        )
        .map((c) => ({ href: `/contracts/${c.id}`, label: `${c.title} · ${c.provider}` }));
    } else if (proposal.kind === "PRODUCT") {
      hints = products
        .filter(
          (p) =>
            (norm(data.serialNumber) && norm(p.serialNumber) === norm(data.serialNumber)) ||
            (norm(p.description) === norm(data.description) &&
              norm(p.manufacturer) === norm(data.manufacturer) &&
              norm(p.model) === norm(data.model)),
        )
        .map((p) => ({ href: `/products/${p.id}`, label: p.description }));
    } else {
      hints = items
        .filter(
          (i) =>
            (norm(data.serialNumber) && norm(i.serialNumber) === norm(data.serialNumber)) ||
            (norm(i.label) === norm(data.label) && norm(i.brand) === norm(data.brand) && norm(i.model) === norm(data.model)),
        )
        .map((i) => ({ href: `/inventory/${i.id}`, label: i.label }));
    }
    if (hints.length > 0) result.set(proposal.id, hints);
  }
  return result;
}

/** For the Documents tabs: how many proposals are waiting. */
export async function pendingImportCount(): Promise<number> {
  return prisma.mcpImportProposal.count({ where: { status: "PENDING" } });
}
