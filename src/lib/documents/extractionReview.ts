import { prisma } from "@/lib/prisma";

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

export async function markExtractionReviewFieldsReviewed(
  ownerType: ExtractionReviewOwnerType,
  ownerId: string,
  actorId: string,
) {
  await prisma.extractionReviewField.updateMany({
    where: { ownerType, ownerId, reviewedAt: null },
    data: { reviewedAt: new Date(), reviewedById: actorId },
  });
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
// formData-supplied column name — it goes straight into a Prisma update.
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

function coerceReviewedValue(fieldName: string, raw: string): string | number | Date | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (fieldName === "cost" || fieldName === "price") {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  if (fieldName === "startDate" || fieldName === "endDate" || fieldName === "purchaseDate" || fieldName === "warrantyEndDate") {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return trimmed.slice(0, 500);
}

// Applies any corrections submitted from the review panel, marks every
// pending field reviewed, and clears extractionPending — the single action
// behind both the field-level review UI and the plain "Confirm details"
// fallback (which submits no corrections, just confirms as-is).
export async function reviewAndConfirmExtraction(
  ownerType: ExtractionReviewOwnerType,
  ownerId: string,
  actorId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const allowed = reviewableFieldsFor(ownerType);
  const pending = await prisma.extractionReviewField.findMany({
    where: { ownerType, ownerId, reviewedAt: null },
  });

  const updateData: Record<string, string | number | Date | null> = {};
  for (const field of pending) {
    if (!allowed.includes(field.fieldName)) continue;
    const raw = formData.get(`reviewField:${field.fieldName}`);
    if (typeof raw !== "string") continue;
    updateData[field.fieldName] = coerceReviewedValue(field.fieldName, raw);
  }

  const reviewedAt = new Date();
  try {
    await prisma.$transaction([
      prisma.extractionReviewField.updateMany({
        where: { ownerType, ownerId, reviewedAt: null },
        data: { reviewedAt, reviewedById: actorId },
      }),
      ownerType === "CONTRACT"
        ? prisma.contract.update({
            where: { id: ownerId },
            data: { ...updateData, extractionPending: false, extractionConfirmedAt: reviewedAt, updatedById: actorId },
          })
        : prisma.product.update({
            where: { id: ownerId },
            data: { ...updateData, extractionPending: false, extractionConfirmedAt: reviewedAt, updatedById: actorId },
          }),
    ]);
  } catch {
    return { error: "Record no longer exists." };
  }
  return {};
}
