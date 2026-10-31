import { CheckCircle2, XCircle } from "lucide-react";
import type { ExtractionCapabilities } from "@/lib/documents/textExtraction";

// #480 — shows which stage-1 (local text/OCR) tools this server has, so a
// bare-metal or serverless install can see why auto-fill finds nothing.
// Server component: the probe runs in src/lib/documents/textExtraction.ts.
export function ExtractionCapabilitiesCard({
  capabilities,
  aiKeySet,
  ollamaConfigured,
}: {
  capabilities: ExtractionCapabilities;
  aiKeySet: boolean;
  ollamaConfigured: boolean;
}) {
  const { binaries } = capabilities;
  const rows = [
    {
      label: "Text-layer PDFs",
      ok: capabilities.pdfText,
      detail: binaries.pdftotext ? "pdftotext" : "pdftotext is not installed",
    },
    {
      label: "Scanned PDFs (OCR)",
      ok: capabilities.pdfOcr,
      detail: capabilities.pdfOcr
        ? "pdftoppm + tesseract"
        : [!binaries.pdftoppm && "pdftoppm", !binaries.tesseract && "tesseract"]
            .filter(Boolean)
            .join(" and ") + " not installed",
    },
    {
      label: "Photos (OCR)",
      ok: capabilities.imageOcr,
      detail: binaries.tesseract ? "tesseract" : "tesseract is not installed",
    },
  ];
  const anyMissing = rows.some((row) => !row.ok);

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.label} className="flex items-start gap-2 text-sm">
            {row.ok ? (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden />
            ) : (
              <XCircle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
            )}
            <span>
              <span className="font-medium">{row.label}</span>
              <span className="sr-only">{row.ok ? ": available" : ": unavailable"}</span>
              <span className="text-muted"> · {row.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      {anyMissing && (
        <p className="text-xs text-muted">
          {aiKeySet
            ? "Files these tools can't read are sent to the AI document extraction key below instead."
            : ollamaConfigured
              ? "Ollama only reads extracted text, so files these tools can't read are attached without auto-fill. Add an AI document extraction key below to read them."
              : "Files these tools can't read are attached without auto-fill. Install poppler-utils and tesseract-ocr on the server (the Docker image includes them), or add an AI document extraction key below."}
        </p>
      )}
    </div>
  );
}
