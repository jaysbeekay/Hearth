import { beforeEach, describe, expect, it, vi } from "vitest";

// #480 — stage 1 shells out to pdftotext/pdftoppm/tesseract. These tests stub
// execFile so each binary is either "installed" (returns canned output) or
// missing (fails with ENOENT, exactly what Node raises for a binary not on PATH).
const installed = new Set<string>();
// Present but failing: the error execFile reports for that binary's probe.
const probeErrors = new Map<string, Error>();
const calls: string[] = [];

vi.mock("child_process", () => ({
  execFile: (
    file: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void,
  ) => {
    calls.push(`${file} ${args.join(" ")}`);
    const probeError = probeErrors.get(file);
    if (probeError) {
      cb(probeError);
      return;
    }
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
  vi.useRealTimers();
  installed.clear();
  probeErrors.clear();
  calls.length = 0;
  resetExtractionCapabilitiesCache();
});

describe("text extraction with missing binaries (#480)", () => {
  it("reports every capability missing when nothing is installed", async () => {
    expect(await getExtractionCapabilities()).toEqual({
      binaries: { pdftotext: false, pdftoppm: false, tesseract: false },
      status: { pdftotext: "missing", pdftoppm: "missing", tesseract: "missing" },
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
    // An inbox PDF whose stored text is empty needed OCR, which is missing, so
    // the inbox must report it unavailable even though pdftotext works.
    expect(await isTextExtractionUnavailableFor("application/pdf")).toBe(true);
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

  it("does not flag an empty PDF when OCR is available (genuinely blank scan)", async () => {
    installed.add("pdftotext").add("pdftoppm").add("tesseract");
    expect(await isTextExtractionUnavailableFor("application/pdf")).toBe(false);
  });

  it("reports a binary that can't be executed (EACCES) as unusable, not available", async () => {
    probeErrors.set("tesseract", Object.assign(new Error("spawn tesseract EACCES"), { code: "EACCES" }));
    const caps = await getExtractionCapabilities();
    expect(caps.status.tesseract).toBe("unusable");
    expect(caps.imageOcr).toBe(false);
    expect(await extractTextDetailed(png, "image/png")).toEqual({ text: "", unavailable: true });
  });

  it("reports a probe that times out as unusable", async () => {
    probeErrors.set(
      "pdftotext",
      Object.assign(new Error("timed out"), { code: null, killed: true, signal: "SIGTERM" }),
    );
    const caps = await getExtractionCapabilities();
    expect(caps.status.pdftotext).toBe("unusable");
    expect(caps.pdfText).toBe(false);
  });

  it("treats a non-zero exit from the version probe as available (old poppler)", async () => {
    probeErrors.set("pdftotext", Object.assign(new Error("exit 99"), { code: 99, killed: false, signal: null }));
    expect((await getExtractionCapabilities()).status.pdftotext).toBe("available");
  });

  it("re-probes a missing binary after a minute, so installing it needs no restart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
    expect((await getExtractionCapabilities()).imageOcr).toBe(false);
    installed.add("tesseract");
    // Still cached within the TTL.
    expect((await getExtractionCapabilities()).imageOcr).toBe(false);
    vi.setSystemTime(new Date("2026-10-31T10:01:01Z"));
    expect((await getExtractionCapabilities()).imageOcr).toBe(true);
    // A positive result stays cached.
    vi.setSystemTime(new Date("2026-10-31T11:00:00Z"));
    await getExtractionCapabilities();
    expect(calls.filter((c) => c === "tesseract --version")).toHaveLength(2);
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
