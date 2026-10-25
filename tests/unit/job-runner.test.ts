// #432 — a job that never settles must not stop job processing: it times
// out and is released for a retry, later ticks still claim other jobs, and
// a lease lost on the last attempt is failed rather than left RUNNING.
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupTestDb } from "../helpers/testDb";

const { runExpirationCheck, runEmailIngestion, runBackup, refreshAllPortfolioPrices } = vi.hoisted(() => ({
  runExpirationCheck: vi.fn<() => Promise<void>>(),
  runEmailIngestion: vi.fn<() => Promise<void>>(),
  runBackup: vi.fn<() => Promise<void>>(),
  refreshAllPortfolioPrices: vi.fn<() => Promise<void>>(),
}));

vi.mock("@/lib/notifications/scheduler", () => ({ runExpirationCheck }));
vi.mock("@/lib/emailIngestion/scheduler", () => ({ runEmailIngestion }));
vi.mock("@/lib/backup/scheduler", () => ({ runBackup }));
vi.mock("@/lib/prices", () => ({ refreshAllPortfolioPrices }));
vi.mock("@/lib/documents/textExtraction", () => ({ extractSearchableText: vi.fn() }));
vi.mock("@/lib/storage", () => ({ readDocument: vi.fn(), readProductDocument: vi.fn(), readInboxDocument: vi.fn() }));

import { LEASE_MS, createJobTick, enqueueJobUnlessPending, runOneJob, runPendingJobs } from "@/lib/jobs/runner";

const db = setupTestDb();

// Lets a test end a deliberately hung job so nothing is left pending.
let release: (() => void) | undefined;
function hang(): Promise<void> {
  return new Promise((resolve) => {
    release = resolve;
  });
}

// Runs left in flight by a test, settled before the next test resets the DB.
const inFlight: Promise<unknown>[] = [];

afterEach(async () => {
  release?.();
  release = undefined;
  await Promise.allSettled(inFlight.splice(0));
  vi.clearAllMocks();
});

async function job(type: string) {
  return db.prisma.backgroundJob.findFirstOrThrow({ where: { type } });
}

describe("job runner", () => {
  it("times out a job that never settles and releases it for a retry", async () => {
    runExpirationCheck.mockImplementation(hang);
    await enqueueJobUnlessPending("REMINDER_CHECK");

    await expect(runOneJob({ timeoutMs: 50 })).resolves.toBe(true);

    const row = await job("REMINDER_CHECK");
    expect(row.status).toBe("PENDING");
    expect(row.lastError).toMatch(/timed out/);
    expect(row.attempts).toBe(1);
    expect(row.leasedUntil).toBeNull();
    // Still the active attempt for its singleton type until retries run out.
    expect(row.activeDedupeKey).toBe("REMINDER_CHECK");
  });

  it("keeps claiming other jobs while one tick is stuck on a hung job", async () => {
    runExpirationCheck.mockImplementation(hang);
    runEmailIngestion.mockResolvedValue(undefined);
    await enqueueJobUnlessPending("REMINDER_CHECK");
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    await enqueueJobUnlessPending("EMAIL_INGEST");

    let clock = 1_000_000;
    // An hour-long job timeout: this run really is stuck for the whole test.
    const tick = createJobTick(() => runPendingJobs(1, { timeoutMs: 60 * 60_000 }), { now: () => clock });

    inFlight.push(tick());
    await vi.waitFor(() => {
      expect(runExpirationCheck).toHaveBeenCalled();
    });

    // The next 20s tick is skipped while the first is still within the lease…
    clock += 20_000;
    await tick();
    expect((await job("EMAIL_INGEST")).status).toBe("PENDING");

    // …but once it has been stuck longer than the lease, ticks run again.
    clock += LEASE_MS;
    await tick();
    expect(runEmailIngestion).toHaveBeenCalledTimes(1);
    expect((await job("EMAIL_INGEST")).status).toBe("DONE");
  });

  it("does not make a direct run wait for a hung one", async () => {
    runExpirationCheck.mockImplementation(hang);
    runEmailIngestion.mockResolvedValue(undefined);
    await enqueueJobUnlessPending("REMINDER_CHECK");
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    await enqueueJobUnlessPending("EMAIL_INGEST");

    inFlight.push(runPendingJobs(1, { timeoutMs: 60 * 60_000 }));
    await vi.waitFor(() => {
      expect(runExpirationCheck).toHaveBeenCalled();
    });

    // /api/cron's path: claims the next job straight away.
    await runPendingJobs(5);
    expect((await job("EMAIL_INGEST")).status).toBe("DONE");
  });

  it("reclaims a job whose lease expired", async () => {
    runBackup.mockResolvedValue(undefined);
    await db.prisma.backgroundJob.create({
      data: {
        type: "BACKUP_RUN",
        payload: "{}",
        status: "RUNNING",
        attempts: 1,
        leasedUntil: new Date(Date.now() - 1000),
        activeDedupeKey: "BACKUP_RUN",
      },
    });

    await expect(runOneJob()).resolves.toBe(true);
    expect(runBackup).toHaveBeenCalledTimes(1);
    const row = await job("BACKUP_RUN");
    expect(row.status).toBe("DONE");
    expect(row.attempts).toBe(2);
    expect(row.activeDedupeKey).toBeNull();
  });

  it("fails a job that lost its lease on the last attempt, freeing its type", async () => {
    await db.prisma.backgroundJob.create({
      data: {
        type: "PRICE_REFRESH",
        payload: "{}",
        status: "RUNNING",
        attempts: 3,
        leasedUntil: new Date(Date.now() - 1000),
        activeDedupeKey: "PRICE_REFRESH",
      },
    });

    await expect(runOneJob()).resolves.toBe(false);
    const row = await job("PRICE_REFRESH");
    expect(row.status).toBe("FAILED");
    expect(row.activeDedupeKey).toBeNull();
    expect(await enqueueJobUnlessPending("PRICE_REFRESH")).not.toBeNull();
  });
});
