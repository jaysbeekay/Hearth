// Client-safe constant — split out of storage.ts (which imports fs/promises
// and can't be bundled into client components like FileDropZone).
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
