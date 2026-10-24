// Vitest setup file (vitest.config.ts → test.setupFiles), run before every
// unit test file. Points DATABASE_URL and UPLOADS_DIR at a fresh temp
// directory before anything can import "@/lib/prisma" or "@/lib/env", so no
// unit test can ever reach the real ./data database or uploads. The database
// file stays empty unless the test file calls setupTestDb() (testDb.ts).
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

const dir = mkdtempSync(path.join(os.tmpdir(), "hearth-unit-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.UPLOADS_DIR = path.join(dir, "uploads");
process.env.HEARTH_TEST_TMP_DIR = dir;
// src/lib/prisma.ts caches its client on globalThis outside production; drop
// any client a previous file in this worker left behind for its own database.
delete (globalThis as { prisma?: unknown }).prisma;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
