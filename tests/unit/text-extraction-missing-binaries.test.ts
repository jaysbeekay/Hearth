import { beforeEach, describe, expect, it, vi } from "vitest";

// #480 — stage 1 shells out to pdftotext/pdftoppm/tesseract. These tests stub
// execFile so each binary is either "installed" (returns canned output) or
// missing (fails with ENOENT, exactly what Node raises for a binary not on PATH).
const installed = new Set<string>();
const calls: string[] = [];

vi.mock("child_process", () => ({
  execFile: (
    file: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void,
  ) => {
    calls.push(`${file} ${args.join(" ")}`);
    if (!installed.has(file)) {
      const err = Object.assign(new Error(`spawn ${file} ENOENT`), { code: "ENOENT" });
      cb(err);
      return;
    }
    const isProbe = args[0] === "-v" || args[0] === "--version";
    const stdout =
      isProbe ? "" : file === "pdftotext" ? "x".repeat(10) : file === "tesseract" ? "OCR TEXT" : "";
    cb(null, { stdout, stderr: "" });
  },
}));

import {
  extractSearchableText,
  extractTextDetailed,
  getExtractionCapabilities,
  isTextExtractionUnavailableFor,
  resetExtractionCapabilitiesCache,
} from "@/lib/documents/textExtraction";
import { extractionMessage, TEXT_EXTRACTION_UNAVAILABLE_MESSAGE } from "@/lib/autoFillHighlight";

const pdf = Buffer.from("%PDF-1.4 test");
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

beforeEach(() => {
  installed.clear();
  calls.length = 0;
  resetExtractionCapabilitiesCache();
});

describe("text extraction with missing binaries (#480)", () => {
  it("reports every capability missing when nothing is installed", async () => {
    expect(await getExtractionCapabilities()).toEqual({
      binaries: { pdftotext: false, pdftoppm: false, tesseract: false },
      pdfText: false,
      pdfOcr: false,
      imageOcr: false,
    });
  });

  it("skips stage 1 for a PDF and flags it unavailable without spawning extraction", async () => {
    expect(await extractTextDetailed(pdf, "application/pdf")).toEqual({ text: "", unavailable: true });
    // Only the probes ran, never `pdftotext -layout` or `pdftoppm -png`.
    expect(calls.every((c) => c.endsWith(" -v") || c.endsWith(" --version"))).toBe(true);
    expect(await isTextExtractionUnavailableFor("application/pdf")).toBe(true);
  });

  it("flags a photo unavailable when tesseract is missing", async () => {
    expect(await extractTextDetailed(png, "image/png")).toEqual({ text: "", unavailable: true });
    expect(await isTextExtractionUnavailableFor("image/jpeg")).toBe(true);
  });

  it("flags a scanned PDF unavailable when only pdftotext is installed", async () => {
    installed.add("pdftotext"); // returns a too-short text layer, i.e. a scan
    expect(await extractTextDetailed(pdf, "application/pdf")).toEqual({ text: "", unavailable: true });
    // A text-layer PDF could still be read, so the type as a whole isn't unavailable.
    expect(await isTextExtractionUnavailableFor("application/pdf")).toBe(false);
  });

  it("OCRs a PDF when poppler-utils and tesseract are present (Docker behaviour)", async () => {
    installed.add("pdftotext").add("pdftoppm").add("tesseract");
    // pdftoppm is stubbed and writes no pages, so OCR returns empty text,
    // but the tools ran and nothing is reported unavailable.
    expect(await extractTextDetailed(pdf, "application/pdf")).toEqual({ text: "", unavailable: false });
    expect(calls.some((c) => c.startsWith("pdftoppm -png"))).toBe(true);
  });

  it("OCRs a photo when tesseract is present", async () => {
    installed.add("tesseract");
    expect(await extractTextDetailed(png, "image/png")).toEqual({ text: "OCR TEXT", unavailable: false });
  });

  it("never flags Word documents, which are attach-only by design", async () => {
    expect(await extractTextDetailed(Buffer.from("x"), "application/msword")).toEqual({
      text: "",
      unavailable: false,
    });
    expect(await isTextExtractionUnavailableFor("application/msword")).toBe(false);
  });

  it("caches the probe so a missing binary is only checked once", async () => {
    await extractTextDetailed(png, "image/png");
    await extractTextDetailed(png, "image/png");
    expect(calls.filter((c) => c === "tesseract --version")).toHaveLength(1);
  });

  it("searchable-text extraction still saves the document (null text) when tools are missing", async () => {
    expect(await extractSearchableText(pdf, "application/pdf")).toBeNull();
  });
});

describe("extractionMessage when text extraction is unavailable", () => {
  it("explains the missing tools instead of 'couldn't detect anything'", () => {
    expect(extractionMessage("heuristic", 0, true)).toBe(TEXT_EXTRACTION_UNAVAILABLE_MESSAGE);
    expect(extractionMessage("heuristic", 0)).toMatch(/Couldn't confidently detect/);
  });

  it("keeps the normal message when a fallback (cloud AI) still filled fields", () => {
    expect(extractionMessage("byok", 3, true)).toMatch(/using AI/);
  });
});
