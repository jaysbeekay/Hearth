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

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "doc-extract-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function ocrImage(filePath: string): Promise<string> {
  const { stdout } = await execFileAsync("tesseract", [filePath, "stdout"], {
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER_BYTES,
  });
  return stdout;
}

async function extractPdfTextLayer(filePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", filePath, "-"], {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
    });
    return stdout;
  } catch {
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
  } catch {
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

// Word documents are attached as-is without OCR/auto-fill: .docx is a zip of
// XML and .doc a legacy binary format, neither of which tesseract/poppler read.
export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  return withTempDir(async (dir) => {
    if (mimeType === "application/pdf") {
      const inputPath = path.join(dir, "input.pdf");
      await writeFile(inputPath, buffer);

      const textLayer = await extractPdfTextLayer(inputPath);
      if (textLayer.trim().length >= MIN_TEXT_LAYER_LENGTH) return textLayer;

      return ocrPdf(inputPath, dir);
    }

    if (mimeType.startsWith("image/")) {
      const ext = mimeType.split("/")[1] ?? "img";
      const inputPath = path.join(dir, `input.${ext}`);
      await writeFile(inputPath, buffer);
      try {
        return await ocrImage(inputPath);
      } catch {
        return "";
      }
    }

    return "";
  });
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
  try {
    const text = (await extractText(buffer, mimeType)).trim();
    return text ? text.slice(0, MAX_SEARCHABLE_TEXT_LENGTH) : null;
  } catch {
    return null;
  }
}
