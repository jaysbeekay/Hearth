import { CheckCircle2, XCircle } from "lucide-react";
import type {
  BinaryStatus,
  ExtractionBinary,
  ExtractionCapabilities,
} from "@/lib/documents/textExtraction";

function problemText(status: Exclude<BinaryStatus, "available">) {
  return status === "missing" ? "not installed" : "installed but can't run (check permissions)";
}

// A Map lookup rather than status[b], which Codacy flags as an object
// injection sink (same pattern as ReminderHealthCard's channel labels).
function describeProblems(status: Record<ExtractionBinary, BinaryStatus>, needed: ExtractionBinary[]) {
  const lookup = new Map(Object.entries(status) as [ExtractionBinary, BinaryStatus][]);
  return needed
    .flatMap((binary) => {
      const s = lookup.get(binary);
      return s && s !== "available" ? [`${binary} ${problemText(s)}`] : [];
    })
    .join("; ");
}

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
  const { status } = capabilities;
  const rows = [
    {
      label: "Text-layer PDFs",
      ok: capabilities.pdfText,
      detail: capabilities.pdfText ? "pdftotext" : describeProblems(status, ["pdftotext"]),
    },
    {
      label: "Scanned PDFs (OCR)",
      ok: capabilities.pdfOcr,
      detail: capabilities.pdfOcr
        ? "pdftoppm + tesseract"
        : describeProblems(status, ["pdftoppm", "tesseract"]),
    },
    {
      label: "Photos (OCR)",
      ok: capabilities.imageOcr,
      detail: capabilities.imageOcr ? "tesseract" : describeProblems(status, ["tesseract"]),
    },
  ];
  const anyMissing = rows.some((row) => !row.ok);
  const anyUnusable = Object.values(status).some((s) => s === "unusable");

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
          {anyUnusable && "A tool that is installed but can't run usually needs its execute permission or PATH fixed. "}
          {aiKeySet
            ? "Files these tools can't read are sent to the AI document extraction key below instead."
            : ollamaConfigured
              ? "Ollama only reads extracted text, so files these tools can't read are attached without auto-fill. Add an AI document extraction key below to read them."
              : "Files these tools can't read are attached without auto-fill. Install poppler-utils and tesseract-ocr on the server (the Docker image includes them), or add an AI document extraction key below."}
          {" Hearth re-checks missing tools about once a minute, so no restart is needed after installing them."}
        </p>
      )}
    </div>
  );
}
