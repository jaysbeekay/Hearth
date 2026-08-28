import { prisma } from "@/lib/prisma";

export type ExtractionReviewOwnerType = "CONTRACT" | "PRODUCT";

interface SubmittedReviewField {
  fieldName: string;
  value?: string | null;
  source?: string | null;
  confidence?: number | null;
}

function parseSubmittedReviewFields(formData: FormData): SubmittedReviewField[] {
  const raw = formData.get("extractionReviewFields");
  if (typeof raw !== "string" || !raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
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
