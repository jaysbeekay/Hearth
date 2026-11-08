import { enqueueJob } from "@/lib/jobs/runner";
import type { SearchTextKind } from "@/lib/documents/documentText";

// "contract"/"product"/"inbox" predate #398; the other kinds are named by
// their Document kind (SEARCH_TEXT_KINDS).
export type ExtractionJobKind = "contract" | "product" | "inbox" | SearchTextKind;

export interface ExtractionJobPayload {
  kind: ExtractionJobKind;
  id: string;
  ownerId?: string;
  storedName: string;
  mimeType: string;
}

export function queueDocumentExtraction(payload: ExtractionJobPayload) {
  return enqueueJob("OCR_DOCUMENT", { ...payload });
}
