// Temporary migrated SQLite database for vitest tests that exercise real
// Prisma writes, such as the record commands in src/lib/commands (ADR 0003).
//
// Usage, in a tests/unit/*.test.ts file:
//
//   import { vi } from "vitest";
//   import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
//
//   // revalidatePath needs a Next request context; stub it.
//   vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
//
//   const db = setupTestDb(); // migrates in beforeAll, empties every table before each test
//
//   it("…", async () => {
//     const user = await createTestUser();
//     await setModuleEnabled("VEHICLES", true);
//     // call the command, then assert with db.prisma
//   });
//
// DATABASE_URL and UPLOADS_DIR already point at a per-file temp directory
// (set by tests/helpers/testDbEnv.ts, a vitest setupFile), so the database is
// a fresh file and uploads land in db.uploadsDir; both are deleted after the
// file's tests finish. `prisma migrate deploy` runs once per test file.
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import type { ModuleKey } from "@/lib/modules/registry";

const repoRoot = path.resolve(__dirname, "../..");

export interface TestDb {
  prisma: typeof prisma;
  databaseUrl: string;
  uploadsDir: string;
}

function migrate(databaseUrl: string) {
  // Same as e2e/prepare-db.ts: Prisma's schema engine can fail with a blank
  // error when migrate deploy has to create the SQLite file itself.
  const file = databaseUrl.slice("file:".length);
  if (!existsSync(file)) closeSync(openSync(file, "w"));
  execFileSync(path.join(repoRoot, "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "pipe",
  });
}

/** Deletes every row from every table (migrations history excepted). */
export async function resetTestDb() {
  const rows = await prisma.$queryRawUnsafe<{ name: string; sql: string | null }[]>(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations'",
  );
  // FTS5 tables (document_search_fts) keep their index in shadow tables
  // named "<table>_*"; deleting from those directly corrupts the index, so
  // only the virtual table itself is emptied.
  const virtualTables = rows.filter((r) => /^CREATE VIRTUAL TABLE/i.test(r.sql ?? "")).map((r) => r.name);
  const tables = rows.filter((r) => !virtualTables.some((v) => r.name.startsWith(`${v}_`)));
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  try {
    for (const { name } of tables) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${name.replace(/"/g, '""')}"`);
    }
  } finally {
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  }
}

/**
 * Registers the lifecycle hooks for this test file and returns the handle.
 * Call it once, at the top level of the file.
 */
export function setupTestDb(options: { resetBetweenTests?: boolean } = {}): TestDb {
  const { resetBetweenTests = true } = options;
  const databaseUrl = process.env.DATABASE_URL;
  const uploadsDir = process.env.UPLOADS_DIR;
  if (!databaseUrl || !uploadsDir || !process.env.HEARTH_TEST_TMP_DIR) {
    throw new Error("setupTestDb() needs tests/helpers/testDbEnv.ts registered as a vitest setupFile");
  }

  beforeAll(() => {
    migrate(databaseUrl);
  }, 120_000);

  if (resetBetweenTests) {
    beforeEach(async () => {
      await resetTestDb();
    });
  }

  afterAll(async () => {
    await prisma.$disconnect();
  });

  return { prisma, databaseUrl, uploadsDir };
}

let userCounter = 0;

/** Inserts a household member to act as the command's actor. */
export async function createTestUser(overrides: { name?: string; email?: string; role?: "ADMIN" | "MEMBER" | "READONLY" } = {}) {
  userCounter += 1;
  return prisma.user.create({
    data: {
      name: overrides.name ?? `Test user ${userCounter}`,
      email: overrides.email ?? `test-user-${userCounter}-${Date.now()}@example.test`,
      passwordHash: "not-a-real-hash",
      role: overrides.role ?? "MEMBER",
    },
  });
}

/** Turns an opt-in module on or off, as Settings → Modules would. */
export async function setModuleEnabled(key: ModuleKey, enabled: boolean) {
  await prisma.moduleEnablement.upsert({
    where: { key },
    create: { key, enabled },
    update: { enabled },
  });
}
