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

// Fixed per binary; a function rather than PROBE_ARGS[binary], which Codacy
// flags as an object injection sink.
function probeArgs(binary: ExtractionBinary): string[] {
  return binary === "tesseract" ? ["--version"] : ["-v"];
}
const PROBE_TIMEOUT_MS = 5_000;

// "available": the probe ran (even a non-zero exit: old poppler builds exit 1
// for `-v`). "missing": not on PATH (ENOENT). "unusable": present but it
// couldn't be run, e.g. EACCES, a probe timeout or a crash on a signal, so the
// settings card must not claim it works.
export type BinaryStatus = "available" | "missing" | "unusable";

// A negative result is re-probed after this long, so installing the tools on
// a running bare-metal server is picked up without a restart. A positive
// result stays cached; a real call that hits ENOENT/EACCES downgrades it.
const NEGATIVE_PROBE_TTL_MS = 60_000;

interface ProbeEntry {
  status: Promise<BinaryStatus>;
  settled?: BinaryStatus;
  probedAt: number;
}
const binaryStatus = new Map<ExtractionBinary, ProbeEntry>();

function isMissingBinaryError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

// ENOENT (not installed) or EACCES (installed, not executable): the tool
// couldn't run at all, as opposed to running and failing on this file.
function isUnrunnableBinaryError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "EACCES";
}

export function classifyProbeError(error: unknown): BinaryStatus {
  const e = error as {
    code?: string | number;
    killed?: boolean;
    signal?: string | null;
  } | null;
  if (e?.code === "ENOENT") return "missing";
  if (typeof e?.code === "number" && !e.killed && !e.signal) return "available";
  return "unusable";
}

function probeStatus(binary: ExtractionBinary): Promise<BinaryStatus> {
  const cached = binaryStatus.get(binary);
  const stale =
    cached?.settled !== undefined &&
    cached.settled !== "available" &&
    Date.now() - cached.probedAt >= NEGATIVE_PROBE_TTL_MS;
  if (cached && !stale) return cached.status;

  const entry: ProbeEntry = {
    probedAt: Date.now(),
    status: execFileAsync(binary, probeArgs(binary), { timeout: PROBE_TIMEOUT_MS }).then(
      () => "available" as const,
      (error: unknown) => classifyProbeError(error),
    ),
  };
  entry.status.then((status) => {
    entry.settled = status;
  });
  binaryStatus.set(binary, entry);
  return entry.status;
}

async function isBinaryAvailable(binary: ExtractionBinary): Promise<boolean> {
  return (await probeStatus(binary)) === "available";
}

// A real call that fails because the binary is gone (ENOENT) or can't be run
// (EACCES) updates the cache so later uploads skip it; the TTL above still
// re-probes it later.
function noteFailure(binary: ExtractionBinary, error: unknown) {
  if (!isUnrunnableBinaryError(error)) return;
  const status: BinaryStatus = isMissingBinaryError(error) ? "missing" : "unusable";
  binaryStatus.set(binary, { status: Promise.resolve(status), settled: status, probedAt: Date.now() });
}

export interface ExtractionCapabilities {
  binaries: Record<ExtractionBinary, boolean>;
  /** Why a binary is or isn't usable. */
  status: Record<ExtractionBinary, BinaryStatus>;
  /** Text-layer PDFs (pdftotext). */
  pdfText: boolean;
  /** Scanned PDFs (pdftoppm + tesseract). */
  pdfOcr: boolean;
  /** Photos and image scans (tesseract). */
  imageOcr: boolean;
}

export async function getExtractionCapabilities(): Promise<ExtractionCapabilities> {
  const results = await Promise.all(EXTRACTION_BINARIES.map((b) => probeStatus(b)));
  const entries = EXTRACTION_BINARIES.map((b, i) => [b, results[i]] as const);
  const status = Object.fromEntries(entries) as Record<ExtractionBinary, BinaryStatus>;
  const binaries = Object.fromEntries(
    entries.map(([b, s]) => [b, s === "available"]),
  ) as Record<ExtractionBinary, boolean>;
  return {
    binaries,
    status,
    pdfText: binaries.pdftotext,
    pdfOcr: binaries.pdftoppm && binaries.tesseract,
    imageOcr: binaries.tesseract,
  };
}

/**
 * For a file whose stage-1 text came back EMPTY (e.g. the inbox's stored
 * text): true when that emptiness is explained by a missing/unusable tool
 * rather than by a blank document. An empty PDF result means the text layer
 * was missing or too short, i.e. it needed OCR, so it is unavailable whenever
 * OCR is, even if pdftotext works.
 */
export async function isTextExtractionUnavailableFor(mimeType: string): Promise<boolean> {
  if (mimeType === "application/pdf") return !(await getExtractionCapabilities()).pdfOcr;
  if (mimeType.startsWith("image/")) return !(await isBinaryAvailable("tesseract"));
  return false;
}

/** Test-only: forget cached probe results. */
export function resetExtractionCapabilitiesCache() {
  binaryStatus.clear();
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
        return { text: "", unavailable: isUnrunnableBinaryError(error) };
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
