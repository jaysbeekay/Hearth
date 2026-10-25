import type { Client, Config } from "@libsql/client";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// #432 — SQLite connection settings.
//
// The libsql adapter funnels every query in this process through one
// adapter-wide mutex, held for the whole of an interactive transaction, and
// the local libsql driver runs each statement synchronously. So one long
// transaction, or a flood of single writes, stalls every other request
// (session lookups included) until it finishes. Keep bulk writes short and
// batched, and yield between batches (see fetchAndStorePriceHistory in
// src/lib/prices.ts).
//
// Two settings make the file itself more forgiving, mostly for a second
// process writing the same database (the e2e suite's own client, a CLI, a
// second app instance):
// - busy_timeout: libsql's `timeout` option sets it on every connection the
//   driver opens, including the fresh one it opens after each transaction
//   (a `PRAGMA busy_timeout` statement would only reach the first one). A
//   locked database is waited out for up to 5 s rather than failing straight
//   away with SQLITE_BUSY.
// - journal_mode = WAL: readers no longer block on a writer, and a commit is
//   an append to the -wal file instead of a rewrite of the journal. The mode
//   is stored in the database file, so setting it once at startup covers
//   every later connection. VACUUM INTO (backups) works the same under WAL.
//   Restoring by replacing app.db must also remove app.db-wal / app.db-shm
//   (see README).
const BUSY_TIMEOUT_MS = 5000;

class HearthLibSql extends PrismaLibSql {
  createClient(config: Config): Client {
    const client = super.createClient(config);
    const isLocalFile = config.url.startsWith("file:") && !config.url.includes(":memory:");
    if (isLocalFile) {
      client.execute("PRAGMA journal_mode = WAL").catch((error: unknown) => {
        console.warn("[db] could not switch SQLite to WAL mode:", error);
      });
    }
    return client;
  }
}

const adapter = new HearthLibSql({
  url: process.env.DATABASE_URL ?? "file:./data/app.db",
  timeout: BUSY_TIMEOUT_MS,
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
