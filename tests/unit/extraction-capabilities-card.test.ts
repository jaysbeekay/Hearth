import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExtractionCapabilitiesCard } from "@/components/ExtractionCapabilitiesCard";
import type { ExtractionCapabilities } from "@/lib/documents/textExtraction";

// #480 review — render the settings card in the degraded states, not only the
// all-installed one the screenshot shows.
function render(capabilities: ExtractionCapabilities, aiKeySet = false) {
  return renderToStaticMarkup(
    createElement(ExtractionCapabilitiesCard, { capabilities, aiKeySet, ollamaConfigured: false }),
  );
}

describe("ExtractionCapabilitiesCard", () => {
  it("shows every row unavailable and the install hint when nothing is installed", () => {
    const html = render({
      binaries: { pdftotext: false, pdftoppm: false, tesseract: false },
      status: { pdftotext: "missing", pdftoppm: "missing", tesseract: "missing" },
      pdfText: false,
      pdfOcr: false,
      imageOcr: false,
    });
    expect(html.match(/: unavailable/g)).toHaveLength(3);
    expect(html).toContain("pdftoppm not installed; tesseract not installed");
    expect(html).toContain("Install poppler-utils and tesseract-ocr");
    expect(html).toContain("no restart is needed");
  });

  it("says a present-but-unrunnable tool can't run, rather than claiming it works", () => {
    const html = render(
      {
        binaries: { pdftotext: true, pdftoppm: true, tesseract: false },
        status: { pdftotext: "available", pdftoppm: "available", tesseract: "unusable" },
        pdfText: true,
        pdfOcr: false,
        imageOcr: false,
      },
      true,
    );
    expect(html).toContain("Text-layer PDFs</span><span class=\"sr-only\">: available");
    expect(html).toContain("tesseract installed but can&#x27;t run");
    expect(html).toContain("execute permission");
    expect(html).toContain("sent to the AI document extraction key");
  });

  it("shows no hint when everything is available", () => {
    const html = render({
      binaries: { pdftotext: true, pdftoppm: true, tesseract: true },
      status: { pdftotext: "available", pdftoppm: "available", tesseract: "available" },
      pdfText: true,
      pdfOcr: true,
      imageOcr: true,
    });
    expect(html).not.toContain(": unavailable");
    expect(html).not.toContain("text-xs text-muted");
  });
});
