import { enqueueJob } from "@/lib/jobs/runner";

export function queueDocumentExtraction(payload: { kind: "contract" | "product" | "inbox"; id: string; ownerId?: string; storedName: string; mimeType: string }) {
  return enqueueJob("OCR_DOCUMENT", payload);
}
