import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const execFileAsync = promisify(execFile);

const COMMAND_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const MAX_OCR_PAGES = 5;
// Below this, a PDF's embedded text layer is treated as missing/negligible
// (i.e. a scanned document), and we fall back to rasterizing + OCR instead.
const MIN_TEXT_LAYER_LENGTH = 40;

// OCR is CPU/process-heavy. Keep concurrent extraction bounded per app
// process so bursts of uploads cannot exhaust memory or child-process slots.
const MAX_CONCURRENT_EXTRACTIONS = 2;
let activeExtractions = 0;
const extractionWaiters: (() => void)[] = [];

async function acquireExtractionSlot(): Promise<() => void> {
  if (activeExtractions >= MAX_CONCURRENT_EXTRACTIONS) {
    await new Promise<void>((resolve) => extractionWaiters.push(resolve));
  }
  activeExtractions += 1;
  return () => {
    activeExtractions -= 1;
    extractionWaiters.shift()?.();
  };
}

// #480 — stage 1 shells out to poppler (pdftotext, pdftoppm) and tesseract.
// The Docker image installs them, but a bare-metal `npm run start` or a
// serverless runtime may not have them. A missing binary used to look the
// same as a blank document, so detect it (lazily, cached per process) and
// report it instead of silently returning empty text.
export const EXTRACTION_BINARIES = ["pdftotext", "pdftoppm", "tesseract"] as const;
export type ExtractionBinary = (typeof EXTRACTION_BINARIES)[number];

const PROBE_ARGS: Record<ExtractionBinary, string[]> = {
  pdftotext: ["-v"],
  pdftoppm: ["-v"],
  tesseract: ["--version"],
};
const PROBE_TIMEOUT_MS = 5_000;

const binaryAvailability = new Map<ExtractionBinary, Promise<boolean>>();

function isMissingBinaryError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

// Only ENOENT means "not installed". Old poppler builds exit non-zero for
// `-v`, and a timeout or other failure still means the binary exists.
function isBinaryAvailable(binary: ExtractionBinary): Promise<boolean> {
  let cached = binaryAvailability.get(binary);
  if (!cached) {
    cached = execFileAsync(binary, PROBE_ARGS[binary], { timeout: PROBE_TIMEOUT_MS }).then(
      () => true,
      (error: unknown) => !isMissingBinaryError(error),
    );
    binaryAvailability.set(binary, cached);
  }
  return cached;
}

// A real call that fails with ENOENT (e.g. the binary was removed after the
// probe) updates the cache so later uploads skip it straight away.
function noteFailure(binary: ExtractionBinary, error: unknown) {
  if (isMissingBinaryError(error)) binaryAvailability.set(binary, Promise.resolve(false));
}

export interface ExtractionCapabilities {
  binaries: Record<ExtractionBinary, boolean>;
  /** Text-layer PDFs (pdftotext). */
  pdfText: boolean;
  /** Scanned PDFs (pdftoppm + tesseract). */
  pdfOcr: boolean;
  /** Photos and image scans (tesseract). */
  imageOcr: boolean;
}

export async function getExtractionCapabilities(): Promise<ExtractionCapabilities> {
  const results = await Promise.all(EXTRACTION_BINARIES.map((b) => isBinaryAvailable(b)));
  const binaries = Object.fromEntries(
    EXTRACTION_BINARIES.map((b, i) => [b, results[i]]),
  ) as Record<ExtractionBinary, boolean>;
  return {
    binaries,
    pdfText: binaries.pdftotext,
    pdfOcr: binaries.pdftoppm && binaries.tesseract,
    imageOcr: binaries.tesseract,
  };
}

/** True when this server has no stage-1 tool that could read this file type. */
export async function isTextExtractionUnavailableFor(mimeType: string): Promise<boolean> {
  if (mimeType === "application/pdf") {
    const caps = await getExtractionCapabilities();
    return !caps.pdfText && !caps.pdfOcr;
  }
  if (mimeType.startsWith("image/")) return !(await isBinaryAvailable("tesseract"));
  return false;
}

/** Test-only: forget cached probe results. */
export function resetExtractionCapabilitiesCache() {
  binaryAvailability.clear();
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "doc-extract-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function ocrImage(filePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("tesseract", [filePath, "stdout"], {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
    });
    return stdout;
  } catch (error) {
    noteFailure("tesseract", error);
    throw error;
  }
}

async function extractPdfTextLayer(filePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", filePath, "-"], {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
    });
    return stdout;
  } catch (error) {
    noteFailure("pdftotext", error);
    return "";
  }
}

async function ocrPdf(filePath: string, dir: string): Promise<string> {
  const prefix = path.join(dir, "page");
  try {
    await execFileAsync(
      "pdftoppm",
      ["-png", "-r", "200", "-f", "1", "-l", String(MAX_OCR_PAGES), filePath, prefix],
      { timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES },
    );
  } catch (error) {
    noteFailure("pdftoppm", error);
    return "";
  }

  const pages = (await readdir(dir)).filter((name) => name.endsWith(".png")).sort();

  const texts: string[] = [];
  for (const page of pages) {
    try {
      texts.push(await ocrImage(path.join(dir, page)));
    } catch {
      // Skip pages that fail to rasterize/OCR rather than failing the whole document.
    }
  }
  return texts.join("\n");
}

export interface TextExtractionResult {
  text: string;
  /**
   * True when the tools this file type needs aren't installed on the server,
   * so stage 1 couldn't run at all (as opposed to running and finding
   * nothing). Callers still try the cloud AI / Ollama fallbacks, and use this
   * to tell the household why nothing was auto-filled.
   */
  unavailable: boolean;
}

// Word documents are attached as-is without OCR/auto-fill: .docx is a zip of
// XML and .doc a legacy binary format, neither of which tesseract/poppler read.
export async function extractTextDetailed(
  buffer: Buffer,
  mimeType: string,
): Promise<TextExtractionResult> {
  if (mimeType === "application/pdf") {
    const caps = await getExtractionCapabilities();
    if (!caps.pdfText && !caps.pdfOcr) return { text: "", unavailable: true };

    return withTempDir(async (dir) => {
      const inputPath = path.join(dir, "input.pdf");
      await writeFile(inputPath, buffer);

      if (caps.pdfText) {
        const textLayer = await extractPdfTextLayer(inputPath);
        if (textLayer.trim().length >= MIN_TEXT_LAYER_LENGTH) {
          return { text: textLayer, unavailable: false };
        }
      }

      // No usable text layer: this is (or may be) a scan, which needs OCR.
      if (!caps.pdfOcr) return { text: "", unavailable: true };
      const text = await ocrPdf(inputPath, dir);
      return { text, unavailable: !(await getExtractionCapabilities()).pdfOcr && !text };
    });
  }

  if (mimeType.startsWith("image/")) {
    if (!(await isBinaryAvailable("tesseract"))) return { text: "", unavailable: true };

    return withTempDir(async (dir) => {
      const ext = mimeType.split("/")[1] ?? "img";
      const inputPath = path.join(dir, `input.${ext}`);
      await writeFile(inputPath, buffer);
      try {
        return { text: await ocrImage(inputPath), unavailable: false };
      } catch (error) {
        return { text: "", unavailable: isMissingBinaryError(error) };
      }
    });
  }

  return { text: "", unavailable: false };
}

export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  return (await extractTextDetailed(buffer, mimeType)).text;
}

const MAX_SEARCHABLE_TEXT_LENGTH = 20_000;

// Best-effort: called at save time so a document's full text is searchable
// later, not just its filename. A failed/slow extraction (missing OCR
// binaries, a corrupt file, an unsupported layout) must never block saving
// the document itself, so every failure mode collapses to null here.
export async function extractSearchableText(
  buffer: Buffer,
  mimeType: string,
): Promise<string | null> {
  const release = await acquireExtractionSlot();
  try {
    const text = (await extractText(buffer, mimeType)).trim();
    return text ? text.slice(0, MAX_SEARCHABLE_TEXT_LENGTH) : null;
  } catch {
    return null;
  } finally {
    release();
  }
}
