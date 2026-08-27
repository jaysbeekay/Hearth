import { randomUUID, createHash } from "crypto";
import path from "path";
import fs from "fs/promises";
import { readValidatedUploadDetails } from "@/lib/uploadValidation";

function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// storedName is always a freshly generated UUID plus a sanitized extension,
// never derived from the user-supplied filename, to avoid path traversal.
function safeExtension(filename: string) {
  const ext = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return ext.length > 0 && ext.length <= 10 ? ext : "";
}

export interface StoredUpload {
  storedName: string;
  size: number;
  sha256: string;
  mimeType: string;
}

// #251 — one shared save/read/remove lifecycle for every document kind's
// file storage, parameterised only by where a given owner's files live.
// Previously each of the 9 kinds (contract, product, trip segment, home
// item, vehicle item, rental statement, inventory item, trade, inbox) hand-
// copied the same four operations — the actual bug this generalises (#233)
// was a fix applied to one kind's delete path that never made it to the
// other eight.
export class DocumentStore {
  constructor(private dirFor: (ownerId: string) => string) {}

  dir(ownerId: string): string {
    return this.dirFor(ownerId);
  }

  async save(ownerId: string, file: File): Promise<StoredUpload> {
    const dir = this.dirFor(ownerId);
    await fs.mkdir(dir, { recursive: true });
    const storedName = `${randomUUID()}${safeExtension(file.name)}`;
    const { buffer, mimeType } = await readValidatedUploadDetails(file);
    await fs.writeFile(path.join(dir, storedName), buffer);
    return { storedName, size: buffer.byteLength, sha256: sha256Hex(buffer), mimeType };
  }

  async read(ownerId: string, storedName: string) {
    return fs.readFile(path.join(this.dirFor(ownerId), path.basename(storedName)));
  }

  async remove(ownerId: string, storedName: string): Promise<void> {
    await fs.rm(path.join(this.dirFor(ownerId), path.basename(storedName)), { force: true });
  }

  async removeAll(ownerId: string): Promise<void> {
    await fs.rm(this.dirFor(ownerId), { recursive: true, force: true });
  }
}

// #251 — reconciliation. Metadata commits to SQLite and file bytes commit to
// disk as two separate steps; a crash between them (or, on delete, between
// removing the DB row and removing the file — every domain's delete path
// does the DB row first, matching how deleteContract/deleteProduct/etc.
// already order it) leaves an orphaned file with nothing referencing it, or
// — the direction this can't repair — a DB row pointing at bytes that never
// arrived. A file with no matching row, once old enough that it can't still
// be a request that's simply mid-flight, is safe to remove; a row with no
// file is reported so a human can decide (re-upload, or accept the loss)
// rather than the record disappearing silently.
const ORPHAN_STALE_MS = 10 * 60_000;

interface ReconcileTarget {
  kind: string;
  store: DocumentStore;
  parentDir: string;
  // Inbox has no owning record — every file sits directly in parentDir
  // rather than in a per-owner subdirectory.
  flat: boolean;
  listOwnerDocuments: (ownerId: string) => Promise<{ storedName: string }[]>;
}

export interface ReconcileReport {
  orphanedFilesRemoved: number;
  rowsMissingFiles: { kind: string; ownerId: string; storedName: string }[];
}

let targets: ReconcileTarget[] = [];

// Registered by storage.ts once, for each of the 9 kinds, rather than
// documentStore.ts importing every domain's Prisma delegate itself — keeps
// this module ignorant of the specific schema shapes it's reconciling.
export function registerReconcileTarget(target: ReconcileTarget): void {
  targets.push(target);
}

export function __resetReconcileTargetsForTests(): void {
  targets = [];
}

async function listOwnerIds(parentDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(parentDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return []; // parentDir doesn't exist yet — nothing uploaded under this kind at all
  }
}

async function isStale(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return Date.now() - stat.mtimeMs > ORPHAN_STALE_MS;
  } catch {
    return false; // already gone
  }
}

export async function reconcileDocumentStore(): Promise<ReconcileReport> {
  const report: ReconcileReport = { orphanedFilesRemoved: 0, rowsMissingFiles: [] };

  for (const target of targets) {
    if (target.flat) {
      const rows = await target.listOwnerDocuments("");
      const known = new Set(rows.map((r) => r.storedName));
      let files: string[];
      try {
        files = await fs.readdir(target.parentDir);
      } catch {
        files = [];
      }
      for (const file of files) {
        if (known.has(file)) continue;
        const fullPath = path.join(target.parentDir, file);
        if (await isStale(fullPath)) {
          await fs.rm(fullPath, { force: true });
          report.orphanedFilesRemoved += 1;
        }
      }
      for (const row of rows) {
        try {
          await fs.access(path.join(target.parentDir, row.storedName));
        } catch {
          report.rowsMissingFiles.push({ kind: target.kind, ownerId: "", storedName: row.storedName });
        }
      }
      continue;
    }

    for (const ownerId of await listOwnerIds(target.parentDir)) {
      const ownerDir = target.store.dir(ownerId);
      const rows = await target.listOwnerDocuments(ownerId);
      const known = new Set(rows.map((r) => r.storedName));

      let files: string[];
      try {
        files = await fs.readdir(ownerDir);
      } catch {
        files = [];
      }
      for (const file of files) {
        if (known.has(file)) continue;
        const fullPath = path.join(ownerDir, file);
        if (await isStale(fullPath)) {
          await fs.rm(fullPath, { force: true });
          report.orphanedFilesRemoved += 1;
        }
      }

      for (const row of rows) {
        try {
          await fs.access(path.join(ownerDir, row.storedName));
        } catch {
          report.rowsMissingFiles.push({ kind: target.kind, ownerId, storedName: row.storedName });
        }
      }
    }
  }

  if (report.rowsMissingFiles.length > 0) {
    console.error(
      `[documentStore] ${report.rowsMissingFiles.length} document row(s) reference a missing file:`,
      report.rowsMissingFiles,
    );
  }

  return report;
}
