import { prisma } from "@/lib/prisma";
import type { ContractReviewCorrections } from "@/lib/commands/contracts";
import type { ProductReviewCorrections } from "@/lib/commands/products";

export type ExtractionReviewOwnerType = "CONTRACT" | "PRODUCT";

interface SubmittedReviewField {
  fieldName: string;
  value?: string | null;
  source?: string | null;
  confidence?: number | null;
}

// No legitimate extraction produces anywhere near this many fields — caps
// the array before it enters a single $transaction, so a maliciously large
// submitted payload can't blow up transaction size/memory.
const MAX_REVIEW_FIELDS = 100;

function parseSubmittedReviewFields(formData: FormData): SubmittedReviewField[] {
  const raw = formData.get("extractionReviewFields");
  if (typeof raw !== "string" || !raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, MAX_REVIEW_FIELDS)
      .filter((field): field is SubmittedReviewField => {
        return (
          field != null &&
          typeof field === "object" &&
          "fieldName" in field &&
          typeof field.fieldName === "string" &&
          field.fieldName.trim().length > 0
        );
      })
      .map((field) => ({
        fieldName: field.fieldName.trim().slice(0, 100),
        value: field.value == null ? null : String(field.value).slice(0, 1000),
        source: field.source == null ? "unknown" : String(field.source).slice(0, 40),
        confidence:
          typeof field.confidence === "number" && Number.isFinite(field.confidence)
            ? Math.max(0, Math.min(1, field.confidence))
            : null,
      }));
  } catch {
    return [];
  }
}

export async function saveExtractionReviewFieldsFromForm(
  ownerType: ExtractionReviewOwnerType,
  ownerId: string,
  formData: FormData,
) {
  const fields = parseSubmittedReviewFields(formData);
  if (fields.length === 0) return;

  await prisma.$transaction(
    fields.map((field) =>
      prisma.extractionReviewField.upsert({
        where: {
          ownerType_ownerId_fieldName: {
            ownerType,
            ownerId,
            fieldName: field.fieldName,
          },
        },
        create: {
          ownerType,
          ownerId,
          contractId: ownerType === "CONTRACT" ? ownerId : null,
          productId: ownerType === "PRODUCT" ? ownerId : null,
          fieldName: field.fieldName,
          value: field.value,
          source: field.source ?? "unknown",
          confidence: field.confidence ?? null,
        },
        update: {
          value: field.value,
          source: field.source ?? "unknown",
          confidence: field.confidence ?? null,
          reviewedAt: null,
          reviewedById: null,
        },
      }),
    ),
  );
}

export interface PendingReviewField {
  fieldName: string;
  currentValue: string;
  source: string;
  confidence: number | null;
}

// #331 — the only fields a field-level review can correct: matches exactly
// what InboxReviewClient/ImportClient record provenance for (see
// appendReviewFields in each). Never widen this to an arbitrary
// formData-supplied column name. The corrections built below name each
// field explicitly; this list decides which pending fields the panel shows.
const CONTRACT_REVIEWABLE_FIELDS = ["title", "provider", "cost", "startDate", "endDate"] as const;
const PRODUCT_REVIEWABLE_FIELDS = ["description", "manufacturer", "price", "purchaseDate", "warrantyEndDate"] as const;

function reviewableFieldsFor(ownerType: ExtractionReviewOwnerType): readonly string[] {
  return ownerType === "CONTRACT" ? CONTRACT_REVIEWABLE_FIELDS : PRODUCT_REVIEWABLE_FIELDS;
}

function fieldToInputValue(fieldName: string, value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

// Field-level values shown in the review panel are read from the live
// record, not the ExtractionReviewField snapshot — so a manual edit made
// via the normal Edit form between extraction and review already shows up
// pre-filled, and re-confirming never clobbers it with a stale value.
export async function getPendingExtractionReview(
  ownerType: ExtractionReviewOwnerType,
  ownerId: string,
): Promise<PendingReviewField[]> {
  const pending = await prisma.extractionReviewField.findMany({
    where: { ownerType, ownerId, reviewedAt: null },
  });
  if (pending.length === 0) return [];

  const allowed = reviewableFieldsFor(ownerType);
  const relevant = pending.filter((f) => allowed.includes(f.fieldName));
  if (relevant.length === 0) return [];

  const record =
    ownerType === "CONTRACT"
      ? await prisma.contract.findUnique({ where: { id: ownerId } })
      : await prisma.product.findUnique({ where: { id: ownerId } });
  if (!record) return [];

  return relevant.map((f) => ({
    fieldName: f.fieldName,
    currentValue: fieldToInputValue(f.fieldName, (record as Record<string, unknown>)[f.fieldName]),
    source: f.source,
    confidence: f.confidence,
  }));
}

// The review panel's submitted value for a field that's still pending, or
// undefined when it isn't pending or wasn't submitted (so it isn't written).
function submittedReviewValue(pending: ReadonlySet<string>, formData: FormData, fieldName: string): string | undefined {
  if (!pending.has(fieldName)) return undefined;
  const raw = formData.get(`reviewField:${fieldName}`);
  return typeof raw === "string" ? raw.trim() : undefined;
}

class ReviewValueError extends Error {}

function requiredText(raw: string | undefined, label: string): string | undefined {
  if (raw === undefined) return undefined;
  if (raw === "") throw new ReviewValueError(`${label} is required`);
  return raw.slice(0, 200);
}

function optionalText(raw: string | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  return raw === "" ? null : raw.slice(0, 200);
}

function optionalAmount(raw: string | undefined, label: string): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new ReviewValueError(`${label} must be a number of 0 or more`);
  return n;
}

function optionalDate(raw: string | undefined, label: string): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === "") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new ReviewValueError(`${label} isn't a valid date`);
  return d;
}

// Drops the keys left undefined, so a field that wasn't reviewed isn't sent.
function definedOnly<T extends object>(patch: T): T {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as T;
}

async function pendingFieldNames(ownerType: ExtractionReviewOwnerType, ownerId: string) {
  const allowed = reviewableFieldsFor(ownerType);
  const pending = await prisma.extractionReviewField.findMany({
    where: { ownerType, ownerId, reviewedAt: null },
    select: { fieldName: true },
  });
  return new Set(pending.map((f) => f.fieldName).filter((name) => allowed.includes(name)));
}

export type ReviewCorrectionsResult<T> = { corrections: T } | { error: string };

// The corrections submitted from the review panel for a Contract's pending
// fields, ready for confirmContractExtractionCommand. A blank optional field
// clears it; a blank title or provider, or a value that doesn't parse, is
// refused. The plain "Confirm details" fallback submits no fields, so it
// confirms the values as they are.
export async function contractReviewCorrectionsFromForm(
  contractId: string,
  formData: FormData,
): Promise<ReviewCorrectionsResult<ContractReviewCorrections>> {
  const pending = await pendingFieldNames("CONTRACT", contractId);
  const value = (fieldName: string) => submittedReviewValue(pending, formData, fieldName);
  try {
    return {
      corrections: definedOnly<ContractReviewCorrections>({
        title: requiredText(value("title"), "Title"),
        provider: requiredText(value("provider"), "Provider/company"),
        cost: optionalAmount(value("cost"), "Cost"),
        startDate: optionalDate(value("startDate"), "Start date"),
        endDate: optionalDate(value("endDate"), "End date"),
      }),
    };
  } catch (error) {
    if (error instanceof ReviewValueError) return { error: error.message };
    throw error;
  }
}

// As contractReviewCorrectionsFromForm, for a Product.
export async function productReviewCorrectionsFromForm(
  productId: string,
  formData: FormData,
): Promise<ReviewCorrectionsResult<ProductReviewCorrections>> {
  const pending = await pendingFieldNames("PRODUCT", productId);
  const value = (fieldName: string) => submittedReviewValue(pending, formData, fieldName);
  try {
    return {
      corrections: definedOnly<ProductReviewCorrections>({
        description: requiredText(value("description"), "Description"),
        manufacturer: optionalText(value("manufacturer")),
        price: optionalAmount(value("price"), "Price"),
        purchaseDate: optionalDate(value("purchaseDate"), "Purchase date"),
        warrantyEndDate: optionalDate(value("warrantyEndDate"), "Warranty end date"),
      }),
    };
  } catch (error) {
    if (error instanceof ReviewValueError) return { error: error.message };
    throw error;
  }
}
