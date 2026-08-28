import { execSync } from "child_process";
import fs from "fs";
import { createClient } from "@libsql/client";
import { DATA_DIR, UPLOADS_DIR, DATABASE_URL } from "./env";

// Runs before every e2e suite invocation, outside of Playwright's own
// lifecycle, so there's no ambiguity about ordering relative to webServer:
// the DB is fully migrated before `playwright test` ever spawns the app.
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Prisma's SQLite schema engine can fail with a blank "Schema engine error"
// when migrate deploy is asked to create the database file itself. Creating an
// empty file first keeps the reset deterministic while still letting Prisma
// apply every migration from scratch.
if (DATABASE_URL.startsWith("file:")) {
  fs.closeSync(fs.openSync(DATABASE_URL.slice("file:".length), "w"));
}

execSync("npx prisma migrate deploy", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL },
});

assertDocumentSearchFtsIntact().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

// #314 — document_search_fts and its 27 sync triggers aren't modeled in
// schema.prisma (Prisma has no way to declare an FTS5 virtual table or SQL
// triggers), so nothing about the normal `prisma generate`/`migrate deploy`
// flow would notice if a future migration silently dropped them. Two
// concrete ways that can happen, verified while building this feature:
//   1. SQLite's RedefineTables fallback (CREATE new_X / copy / DROP TABLE X
//      / rename), which Prisma emits for schema changes to any of the 9
//      document tables it can't express as a plain ALTER — DROP TABLE
//      silently drops any trigger defined on that table.
//   2. `prisma migrate dev`, for literally any unrelated schema.prisma
//      change, treats document_search_fts and its shadow tables
//      (_data/_idx/_docsize/_config) as drift versus schema.prisma and
//      offers to DROP them — confirmed directly against a scratch DB while
//      building this feature. Dropping the FTS table this way does NOT
//      drop the 27 triggers (they're defined on the 9 source tables, not on
//      document_search_fts), so a triggers-only check would pass green
//      while search was silently broken — this checks both.
// This runs on every e2e invocation, so a migration that loses either one
// fails loudly here, on the PR that introduced it, instead of shipping as a
// silent search regression.
async function assertDocumentSearchFtsIntact() {
  const client = createClient({ url: DATABASE_URL });
  try {
    const EXPECTED_TABLES = [
      "documents",
      "inbox_documents",
      "product_documents",
      "trip_segment_documents",
      "rental_statement_documents",
      "home_item_documents",
      "vehicle_item_documents",
      "inventory_item_documents",
      "trade_documents",
    ];
    const expectedTriggers = EXPECTED_TABLES.flatMap((table) => [
      `fts_${table}_ai`,
      `fts_${table}_au`,
      `fts_${table}_ad`,
    ]);

    const tableRow = await client.execute(
      "SELECT count(*) as n FROM sqlite_master WHERE type = 'table' AND name = 'document_search_fts'",
    );
    if (Number(tableRow.rows[0].n) !== 1) {
      throw new Error(
        "document_search_fts table is missing — a migration dropped the FTS5 index (see #314). " +
          "If this followed `prisma migrate dev` for an unrelated schema change, check the generated " +
          "migration.sql for a `DROP TABLE document_search_fts*` and remove it before applying.",
      );
    }

    const triggerRows = await client.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'");
    const actualTriggers = new Set(triggerRows.rows.map((r) => String(r.name)));
    const missing = expectedTriggers.filter((t) => !actualTriggers.has(t));
    if (missing.length > 0) {
      throw new Error(
        `document_search_fts sync trigger(s) missing (see #314): ${missing.join(", ")}. ` +
          "A migration likely rebuilt one of the 9 document tables (SQLite RedefineTables) without " +
          "re-creating its triggers — see the comment above each document model in schema.prisma.",
      );
    }
  } finally {
    client.close();
  }
}
