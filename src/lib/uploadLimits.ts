// Client-safe constant — split out of storage.ts (which imports fs/promises
// and can't be bundled into client components like FileDropZone).
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
