import type { Client, Config } from "@libsql/client";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

// #432 — SQLite connection settings.
//
// The libsql adapter funnels every query in this process through one
// adapter-wide mutex, held for the whole of an interactive transaction, and
// the local libsql driver runs each statement synchronously on the event
// loop. So one long transaction, or a flood of single writes, stalls every
// other request (session lookups included) until it finishes. Keep bulk
// writes short and batched, and yield between batches (see
// fetchAndStorePriceHistory in src/lib/prices.ts).
//
// - One client per process: the client is cached on globalThis in every
//   environment, because Next can load this module more than once (separate
//   server bundles) and each extra client is another connection competing
//   for the file's write lock.
// - busy_timeout: libsql's `timeout` option sets it on every connection the
//   driver opens, including the fresh one it opens after each transaction
//   (a `PRAGMA busy_timeout` statement would only reach the first one). A
//   database locked by another process (a CLI, the e2e suite's own client)
//   is waited out instead of failing straight away with SQLITE_BUSY. It is
//   kept short because the wait is synchronous and blocks the event loop.
// - journal_mode: SQLITE_JOURNAL_MODE, DELETE by default. WAL lets readers
//   carry on while a writer commits, but it needs shared memory that network
//   filesystems (NFS/SMB NAS shares) and Windows folders under WSL2
//   (/mnt/c) don't provide reliably, so it is opt-in. The mode is applied on
//   every start, so setting DELETE again also reverts a file left in WAL.
//   Restoring a backup under WAL must also deal with app.db-wal / app.db-shm
//   (see README).
const BUSY_TIMEOUT_MS = 1000;

export type JournalMode = "DELETE" | "WAL";

export function resolveJournalMode(value: string | undefined): JournalMode {
  const mode = (value ?? "").trim().toUpperCase();
  if (mode === "" || mode === "DELETE") return "DELETE";
  if (mode === "WAL") return "WAL";
  console.warn(`[db] SQLITE_JOURNAL_MODE="${value}" is not DELETE or WAL; using DELETE.`);
  return "DELETE";
}

export const journalMode = resolveJournalMode(process.env.SQLITE_JOURNAL_MODE);

/** Sets the journal mode on a local SQLite client and returns the mode SQLite reports. */
export async function applyJournalMode(client: Pick<Client, "execute">, requested: JournalMode): Promise<string> {
  const result = await client.execute(`PRAGMA journal_mode = ${requested}`);
  const effective = String(result.rows[0]?.journal_mode ?? "unknown").toUpperCase();
  if (effective !== requested) {
    console.warn(`[db] asked SQLite for journal_mode ${requested} but it reports ${effective}.`);
  } else {
    console.log(`[db] SQLite journal_mode ${effective}`);
  }
  return effective;
}

class HearthLibSql extends PrismaLibSql {
  createClient(config: Config): Client {
    const client = super.createClient(config);
    const isLocalFile = config.url.startsWith("file:") && !config.url.includes(":memory:");
    if (isLocalFile) {
      applyJournalMode(client, journalMode).catch((error: unknown) => {
        console.warn(`[db] could not set SQLite journal_mode ${journalMode}:`, error);
      });
    }
    return client;
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  hearthPrismaClients: number | undefined;
};

function createPrismaClient(): PrismaClient {
  const created = (globalForPrisma.hearthPrismaClients ?? 0) + 1;
  globalForPrisma.hearthPrismaClients = created;
  if (created === 2) {
    console.warn("[db] more than one Prisma client created in this process; each one holds its own SQLite connection.");
  }
  const adapter = new HearthLibSql({
    url: process.env.DATABASE_URL ?? "file:./data/app.db",
    timeout: BUSY_TIMEOUT_MS,
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();
globalForPrisma.prisma = prisma;
