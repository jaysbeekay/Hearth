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

import {
  FAILED_RETRY_AFTER_MS,
  LEASE_MS,
  createJobTick,
  enqueueJobUnlessPending,
  lastQueuedRun,
  queueScheduledJob,
  runOneJob,
  runPendingJobs,
} from "@/lib/jobs/runner";
import { resetCronOwedScans } from "@/lib/jobs/cronDue";

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

describe("scheduled runs", () => {
  const HOUR = 60 * 60_000;
  const add = (type: string, createdAt: Date, status = "DONE", payload = "{}") =>
    db.prisma.backgroundJob.create({ data: { type, payload, status, createdAt } });
  const rows = (type: string) => db.prisma.backgroundJob.findMany({ where: { type }, orderBy: { createdAt: "asc" } });

  afterEach(() => {
    resetCronOwedScans();
    vi.useRealTimers();
  });
  // Rows queued now are stamped with the clock, so the clock follows each tick.
  const tick = (at: Date) => {
    vi.setSystemTime(at);
    return queueScheduledJob("REMINDER_CHECK", "0 8 * * *", at);
  };

  it("reports the newest run of a type and the schedule it was queued under", async () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(await lastQueuedRun("REMINDER_CHECK", now)).toBeNull();
    await add("REMINDER_CHECK", new Date("2026-11-05T21:00:00Z"));
    await add("REMINDER_CHECK", new Date("2026-11-06T21:00:00Z"), "DONE", JSON.stringify({ schedule: "0 8 * * *" }));
    await add("BACKUP_RUN", new Date("2026-11-07T11:00:00Z"));
    expect(await lastQueuedRun("REMINDER_CHECK", now)).toEqual({ at: new Date("2026-11-06T21:00:00Z"), schedule: "0 8 * * *" });
  });

  it("ignores a run stamped while the clock was ahead", async () => {
    const now = new Date("2026-11-07T12:00:00Z");
    await add("REMINDER_CHECK", new Date("2026-11-06T21:00:00Z"));
    await add("REMINDER_CHECK", new Date("2026-12-20T21:00:00Z"));
    expect((await lastQueuedRun("REMINDER_CHECK", now))?.at).toEqual(new Date("2026-11-06T21:00:00Z"));
  });

  it("counts a failed run for an hour, then the run before it, up to two retries", async () => {
    const ok = new Date("2026-11-06T21:00:00Z");
    const failed = new Date("2026-11-07T21:00:00Z");
    await add("REMINDER_CHECK", ok);
    await add("REMINDER_CHECK", failed, "FAILED");
    expect((await lastQueuedRun("REMINDER_CHECK", new Date(+failed + HOUR / 2)))?.at).toEqual(failed);
    expect((await lastQueuedRun("REMINDER_CHECK", new Date(+failed + FAILED_RETRY_AFTER_MS + 1)))?.at).toEqual(ok);
    await add("REMINDER_CHECK", new Date(+failed + HOUR), "FAILED");
    expect((await lastQueuedRun("REMINDER_CHECK", new Date(+failed + 2 * HOUR + 1)))?.at).toEqual(ok);
    const lastTry = new Date(+failed + 2 * HOUR);
    await add("REMINDER_CHECK", lastTry, "FAILED");
    // Three failures in a row: wait for the next scheduled time.
    expect((await lastQueuedRun("REMINDER_CHECK", new Date(+failed + 5 * HOUR)))?.at).toEqual(lastTry);
  });

  it("queues a missed run once, however many processes or restarts look", async () => {
    // Yesterday's 08:00 check ran; the server slept through today's and is back at 14:41.
    await add("REMINDER_CHECK", new Date(2026, 10, 6, 8, 0, 1), "DONE", JSON.stringify({ schedule: "0 8 * * *" }));
    const back = new Date(2026, 10, 7, 14, 41, 0);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(back);
    // Two processes ticking at once: neither has scanned anything yet.
    await Promise.all([
      queueScheduledJob("REMINDER_CHECK", "0 8 * * *", back),
      (async () => {
        resetCronOwedScans();
        return queueScheduledJob("REMINDER_CHECK", "0 8 * * *", back);
      })(),
    ]);
    expect(await rows("REMINDER_CHECK")).toHaveLength(2);
    // Later ticks, in either process or after a restart, while it's pending or once it's done.
    await tick(new Date(+back + 60_000));
    runExpirationCheck.mockResolvedValue(undefined);
    await runPendingJobs();
    resetCronOwedScans();
    await tick(new Date(+back + 2 * 60_000));
    await tick(new Date(2026, 10, 7, 23, 0, 0));
    const after = await rows("REMINDER_CHECK");
    expect(after).toHaveLength(2);
    expect(after[1].status).toBe("DONE");
    expect(after[1].payload).toBe(JSON.stringify({ schedule: "0 8 * * *" }));
    expect(runExpirationCheck).toHaveBeenCalledTimes(1);
    // Tomorrow's run is still queued on time.
    await tick(new Date(2026, 10, 8, 8, 0, 3));
    expect(await rows("REMINDER_CHECK")).toHaveLength(3);
  });

  it("retries a check that failed every attempt later the same day", async () => {
    await add("REMINDER_CHECK", new Date(2026, 10, 6, 8, 0, 1));
    const failedAt = new Date(2026, 10, 7, 8, 0, 1);
    await add("REMINDER_CHECK", failedAt, "FAILED");
    expect(await queueScheduledJob("REMINDER_CHECK", "0 8 * * *", new Date(2026, 10, 7, 8, 30, 0))).toBeNull();
    expect(await queueScheduledJob("REMINDER_CHECK", "0 8 * * *", new Date(+failedAt + FAILED_RETRY_AFTER_MS + 60_000))).not.toBeNull();
  });
});
