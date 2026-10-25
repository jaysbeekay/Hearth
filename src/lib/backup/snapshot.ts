import { randomBytes } from "crypto";
import { rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { journalMode, prisma } from "@/lib/prisma";

// SQLite's VACUUM INTO writes a consistent point-in-time copy of the live
// database to a new file without locking out readers/writers, so the app
// keeps running normally while a backup is taken. The target path must not
// already exist, hence the random suffix.
export async function createSnapshot(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const snapshotPath = path.join(tmpdir(), `contracts-backup-${randomBytes(8).toString("hex")}.db`);

  await prisma.$executeRawUnsafe("VACUUM INTO ?", snapshotPath);

  // #432 — under WAL (SQLITE_JOURNAL_MODE=WAL) committed pages can sit in
  // app.db-wal until SQLite checkpoints them. Folding them back into app.db
  // after each backup keeps the -wal file small and app.db itself close to
  // current for anyone copying the data directory. Best-effort: a busy
  // database just checkpoints next time.
  if (journalMode === "WAL") {
    await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)").catch((error: unknown) => {
      console.warn("[backup] WAL checkpoint after snapshot failed:", error);
    });
  }

  return {
    path: snapshotPath,
    cleanup: () => rm(snapshotPath, { force: true }),
  };
}
