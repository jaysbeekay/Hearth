import { guessDocumentType, type GuessableType } from "@/lib/documents/classifyDocument";
import { findDocumentsByHash, type DocumentRef } from "@/lib/documents/documentQueries";
import type { InboxDocumentStatus } from "@/generated/prisma/enums";

export interface InboxIntakeResult {
  status: InboxDocumentStatus;
  guessedType: GuessableType | null;
  /** Populated only when status is POSSIBLE_DUPLICATE — every existing filed document sharing this file's exact hash. */
  duplicateOf: DocumentRef[];
}

/**
 * The single place that decides an inbox document's initial status (#199),
 * shared by the web upload path (saveToInbox) and email ingestion, so both
 * sources land in the same 4-state taxonomy instead of drifting apart.
 *
 * Priority: an exact-hash duplicate is flagged regardless of extraction
 * outcome (it's actionable a different way — attach as a new version, or
 * keep separate), then extraction failure, then whether a type could be
 * guessed. Heuristic-only throughout, same constraint as guessDocumentType.
 */
export async function computeInboxIntake(params: {
  extractedText: string | null;
  sha256: string | null;
}): Promise<InboxIntakeResult> {
  const guessedType = params.extractedText ? guessDocumentType(params.extractedText) : null;

  if (params.sha256) {
    const duplicateOf = await findDocumentsByHash(params.sha256);
    if (duplicateOf.length > 0) {
      return { status: "POSSIBLE_DUPLICATE", guessedType, duplicateOf };
    }
  }

  if (!params.extractedText || !params.extractedText.trim()) {
    return { status: "EXTRACTION_FAILED", guessedType: null, duplicateOf: [] };
  }

  return {
    status: guessedType ? "NEEDS_REVIEW" : "NEEDS_CLASSIFICATION",
    guessedType,
    duplicateOf: [],
  };
}
