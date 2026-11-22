// #481 — the "what's owed" decision the in-process ticker and POST /api/cron
// share: which scheduled job types to queue right now.
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, setModuleEnabled } from "../helpers/testDb";

const configured = vi.hoisted(() => ({ backup: false, emailIngest: false }));

// Whether a backup destination or a mailbox is configured depends on env
// and encryption settings far from what's under test; everything else here
// is real.
vi.mock("@/lib/appSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/appSettings")>()),
  isBackupConfigured: async () => configured.backup,
  isEmailIngestionConfigured: async () => configured.emailIngest,
}));

import { queueOwedScheduledJobs } from "@/lib/jobs/owed";
import { resetCronOwedScans } from "@/lib/jobs/cronDue";

const db = setupTestDb();

const NOW = new Date(2026, 10, 10, 12, 0, 0);
const MINUTE = 60_000;
const FIFTEEN_MINUTES = 15 * MINUTE;

afterEach(() => {
  configured.backup = false;
  configured.emailIngest = false;
  resetCronOwedScans();
});

const types = async () => (await db.prisma.backgroundJob.findMany({ select: { type: true } })).map((row) => row.type).sort();
const addPriceRefresh = (createdAt: Date, status = "DONE") =>
  db.prisma.backgroundJob.create({ data: { type: "PRICE_REFRESH", payload: "{}", status, createdAt } });

describe("queueOwedScheduledJobs", () => {
  it("queues only the reminder check when nothing else is configured or enabled", async () => {
    const queued = await queueOwedScheduledJobs(NOW);
    expect(queued).toEqual(["DOCUMENT_TEXT_BACKFILL", "REMINDER_CHECK"]);
    expect(await types()).toEqual(["DOCUMENT_TEXT_BACKFILL", "REMINDER_CHECK"]);
  });

  it("queues a backup and an email ingest only when each is configured", async () => {
    configured.backup = true;
    const queued = await queueOwedScheduledJobs(NOW);
    expect(queued).toContain("BACKUP_RUN");
    expect(queued).not.toContain("EMAIL_INGEST");
    configured.emailIngest = true;
    resetCronOwedScans();
    expect(await queueOwedScheduledJobs(NOW)).toContain("EMAIL_INGEST");
  });

  it("queues a price refresh when the Wealth module is on and none has run", async () => {
    await setModuleEnabled("WEALTH", true);
    expect(await queueOwedScheduledJobs(NOW)).toContain("PRICE_REFRESH");
  });

  it("never queues a price refresh while the Wealth module is off", async () => {
    await addPriceRefresh(new Date(+NOW - 3 * 60 * MINUTE));
    expect(await queueOwedScheduledJobs(NOW)).not.toContain("PRICE_REFRESH");
  });

  it("owes a price refresh once the last run is 15 minutes old, and not before", async () => {
    await setModuleEnabled("WEALTH", true);
    await addPriceRefresh(new Date(+NOW - FIFTEEN_MINUTES + MINUTE));
    expect(await queueOwedScheduledJobs(NOW)).not.toContain("PRICE_REFRESH");
    expect(await queueOwedScheduledJobs(new Date(+NOW + MINUTE))).toContain("PRICE_REFRESH");
  });

  it("catches up a price refresh the server slept through", async () => {
    await setModuleEnabled("WEALTH", true);
    // Last run three hours ago; no 15-minute boundary was ever "ticked" since.
    await addPriceRefresh(new Date(+NOW - 3 * 60 * MINUTE));
    expect(await queueOwedScheduledJobs(NOW)).toContain("PRICE_REFRESH");
  });

  it("retries a failed price refresh after the same 15 minutes", async () => {
    await setModuleEnabled("WEALTH", true);
    await addPriceRefresh(new Date(+NOW - FIFTEEN_MINUTES), "FAILED");
    expect(await queueOwedScheduledJobs(NOW)).toContain("PRICE_REFRESH");
  });

  it("queues nothing twice when two callers ask at once", async () => {
    await setModuleEnabled("WEALTH", true);
    configured.backup = true;
    configured.emailIngest = true;
    const [first, second] = await Promise.all([queueOwedScheduledJobs(NOW), queueOwedScheduledJobs(NOW)]);
    expect(await types()).toEqual(["BACKUP_RUN", "DOCUMENT_TEXT_BACKFILL", "EMAIL_INGEST", "PRICE_REFRESH", "REMINDER_CHECK"]);
    // Between them, each type was queued exactly once.
    expect([...first, ...second].sort()).toEqual(await types());
  });

  it("does not queue a job type that is still pending", async () => {
    await queueOwedScheduledJobs(NOW);
    resetCronOwedScans();
    expect(await queueOwedScheduledJobs(new Date(+NOW + MINUTE))).toEqual([]);
  });
});
