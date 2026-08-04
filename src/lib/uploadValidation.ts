import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/uploadLimits";

// Every upload path previously trusted `file.type` — a value the browser
// supplies and any HTTP client can set to whatever it likes (#165). That type
// then decided whether the file was accepted, which extraction pipeline ran
// over it (pdftotext, pdftoppm + tesseract), and what Content-Type it was
// served back with. Sniffing the actual leading bytes closes the gap between
// "what the client called it" and "what it is".

export class UploadRejectedError extends Error {}

// Total bytes accepted across one request. The per-file cap alone let a caller
// attach many just-under-the-limit files to a single multipart body.
export const MAX_REQUEST_UPLOAD_BYTES = 40 * 1024 * 1024;

function startsWith(buffer: Buffer, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, i) => buffer[offset + i] === byte);
}

// ISO base-media brands that identify a HEIC/HEIF still image.
const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"];

// Returns the format actually present in the bytes, or null if unrecognised.
export function sniffMimeType(buffer: Buffer): string | null {
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";

  // RIFF....WEBP
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }

  // ....ftyp<brand>
  if (startsWith(buffer, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = buffer.subarray(8, 12).toString("latin1");
    if (HEIC_BRANDS.includes(brand)) return "image/heic";
  }

  // OLE2 compound file — legacy .doc
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return "application/msword";
  }

  // Zip container — .docx (and every other OOXML file). The zip's own
  // directory would be needed to tell them apart; the declared type decides
  // between them, having first been proven to be *a* zip.
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  return null;
}

// Formats whose sniffed identity is allowed to differ from the declared one,
// because their container is shared with other formats.
const CONTAINER_EQUIVALENTS: Record<string, string[]> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};

const GENERIC_MIME_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

export type ValidatedUpload = {
  buffer: Buffer;
  mimeType: string;
};

/**
 * Validates one uploaded file and returns its bytes plus resolved MIME type.
 *
 * Reads the file once and hands the buffer back so callers don't re-read it —
 * every save path needs the bytes anyway.
 */
export async function readValidatedUploadDetails(file: File): Promise<ValidatedUpload> {
  if (file.size === 0) {
    throw new UploadRejectedError("That file is empty.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadRejectedError("File is too large (15MB max).");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffMimeType(buffer);

  if (!sniffed) {
    throw new UploadRejectedError(
      "That file's contents don't match any supported format. Use PDF, Word, or image files.",
    );
  }

  const declared = GENERIC_MIME_TYPES.has(file.type) ? sniffed : file.type;
  if (!ALLOWED_MIME_TYPES.has(declared)) {
    throw new UploadRejectedError("Unsupported file type. Use PDF, Word, or image files.");
  }

  const acceptable = CONTAINER_EQUIVALENTS[sniffed] ?? [sniffed];
  if (!acceptable.includes(declared)) {
    throw new UploadRejectedError(
      `That file is labelled ${declared} but its contents are ${sniffed}.`,
    );
  }

  return { buffer, mimeType: declared };
}

/**
 * Validates one uploaded file and returns its bytes.
 */
export async function readValidatedUpload(file: File): Promise<Buffer> {
  const { buffer } = await readValidatedUploadDetails(file);
  return buffer;
}

// Guards the total size of one multipart request, which the per-file cap
// doesn't bound.
export function assertRequestWithinUploadBudget(files: File[]): void {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_REQUEST_UPLOAD_BYTES) {
    throw new UploadRejectedError(
      `Those files total more than ${Math.round(MAX_REQUEST_UPLOAD_BYTES / 1024 / 1024)}MB. ` +
        "Upload them in smaller batches.",
    );
  }
}

/**
 * Validation for callers that report failures as a message rather than an
 * exception — the server actions, which return `{ error }` for the form to
 * display. Returns null when the file is acceptable.
 *
 * The file is read here and again by the matching storage.ts save*, which is
 * the authoritative check. That's a deliberate duplicate: it keeps the error
 * legible in the UI while leaving storage.ts unable to persist an unvalidated
 * file even if a future caller forgets this.
 */
export async function describeUploadRejection(file: File): Promise<string | null> {
  try {
    await readValidatedUpload(file);
    return null;
  } catch (error) {
    if (error instanceof UploadRejectedError) return error.message;
    throw error;
  }
}
