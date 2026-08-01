import { Directory, Filesystem } from "@capacitor/filesystem";
import type { MobileAttachmentInput } from "@/lib/mobile/repositories";
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/uploadLimits";

const DOCUMENT_ROOT = "standalone-documents";
const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"];
const CONTAINER_EQUIVALENTS: Record<string, string[]> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};

export async function writeProtectedStandaloneFile(input: MobileAttachmentInput): Promise<string> {
  if (!input.blob) {
    throw new Error("A Blob is required to write a protected standalone file.");
  }
  if (input.blob.size === 0 || input.size === 0) {
    throw new Error("That file is empty.");
  }
  if (input.blob.size > MAX_UPLOAD_BYTES || input.size > MAX_UPLOAD_BYTES) {
    throw new Error("File is too large (15MB max).");
  }
  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
    throw new Error("Unsupported file type. Use PDF, Word, or image files.");
  }

  const extension = safeExtension(input.filename);
  const storageKey = `${input.ownerType}/${input.ownerId}/${crypto.randomUUID()}${extension}`;
  const bytes = new Uint8Array(await input.blob.arrayBuffer());
  const sniffed = sniffMimeType(bytes);
  if (!sniffed) {
    throw new Error("That file's contents don't match any supported format. Use PDF, Word, or image files.");
  }
  const acceptable = CONTAINER_EQUIVALENTS[sniffed] ?? [sniffed];
  if (!acceptable.includes(input.mimeType)) {
    throw new Error(`That file is labelled ${input.mimeType} but its contents are ${sniffed}.`);
  }
  const data = bytesToBase64(bytes);

  await Filesystem.writeFile({
    directory: Directory.Data,
    path: `${DOCUMENT_ROOT}/${storageKey}`,
    data,
    recursive: true,
  });

  return storageKey;
}

export async function readProtectedStandaloneFile(storageKey: string): Promise<Blob> {
  const result = await Filesystem.readFile({
    directory: Directory.Data,
    path: `${DOCUMENT_ROOT}/${storageKey}`,
  });

  if (result.data instanceof Blob) return result.data;
  return base64ToBlob(String(result.data));
}

export async function deleteProtectedStandaloneFile(storageKey: string): Promise<void> {
  await Filesystem.deleteFile({
    directory: Directory.Data,
    path: `${DOCUMENT_ROOT}/${storageKey}`,
  }).catch(() => undefined);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBlob(data: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes]);
}

function safeExtension(filename: string): string {
  const match = filename.toLowerCase().match(/\.[a-z0-9]{1,10}$/);
  return match?.[0] ?? "";
}

function startsWith(bytes: Uint8Array, expected: number[], offset = 0): boolean {
  if (bytes.length < offset + expected.length) return false;
  return expected.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function sniffMimeType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4) && HEIC_BRANDS.includes(ascii(bytes, 8, 12))) {
    return "image/heic";
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return "application/msword";
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return null;
}
