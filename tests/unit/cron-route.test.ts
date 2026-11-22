// #481 — POST /api/cron through the real handler: auth, and that one call
// queues and runs every scheduled job that's owed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setupTestDb, setModuleEnabled } from "../helpers/testDb";

const { runExpirationCheck, runEmailIngestion, runBackup, refreshAllPortfolioPrices, configured } = vi.hoisted(() => ({
  runExpirationCheck: vi.fn<() => Promise<void>>(),
  runEmailIngestion: vi.fn<() => Promise<void>>(),
  runBackup: vi.fn<() => Promise<void>>(),
  refreshAllPortfolioPrices: vi.fn<() => Promise<void>>(),
  configured: { backup: false, emailIngest: false },
}));

vi.mock("@/lib/notifications/scheduler", () => ({ runExpirationCheck }));
vi.mock("@/lib/emailIngestion/scheduler", () => ({ runEmailIngestion }));
vi.mock("@/lib/backup/scheduler", () => ({ runBackup }));
vi.mock("@/lib/prices", () => ({ refreshAllPortfolioPrices }));
vi.mock("@/lib/documents/textExtraction", () => ({ extractSearchableText: vi.fn() }));
vi.mock("@/lib/storage", () => ({ readDocument: vi.fn(), readProductDocument: vi.fn(), readInboxDocument: vi.fn() }));
vi.mock("@/lib/appSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/appSettings")>()),
  isBackupConfigured: async () => configured.backup,
  isEmailIngestionConfigured: async () => configured.emailIngest,
}));

import { POST } from "@/app/api/cron/route";
import { resetCronOwedScans } from "@/lib/jobs/cronDue";

const db = setupTestDb();

function request(secret: string | null) {
  const headers: Record<string, string> = {};
  if (secret !== null) headers["x-cron-secret"] = secret;
  return new NextRequest("http://localhost/api/cron", { method: "POST", headers });
}

const statuses = async () =>
  Object.fromEntries((await db.prisma.backgroundJob.findMany()).map((row) => [row.type, row.status]));

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  runExpirationCheck.mockResolvedValue(undefined);
  runEmailIngestion.mockResolvedValue(undefined);
  runBackup.mockResolvedValue(undefined);
  refreshAllPortfolioPrices.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  configured.backup = false;
  configured.emailIngest = false;
  resetCronOwedScans();
});

describe("POST /api/cron", () => {
  it("404s when CRON_SECRET is unset, whatever is sent", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(request("s3cret"))).status).toBe(404);
    expect((await POST(request(null))).status).toBe(404);
    expect(await db.prisma.backgroundJob.count()).toBe(0);
  });

  it("401s a missing, wrong or different-length secret without queueing anything", async () => {
    for (const secret of [null, "wrong", "s3cret-and-more", "s3cre", ""]) {
      expect((await POST(request(secret))).status).toBe(401);
    }
    expect(await db.prisma.backgroundJob.count()).toBe(0);
    expect(runExpirationCheck).not.toHaveBeenCalled();
  });

  it("queues and runs every owed type in one call, and says what it queued", async () => {
    await setModuleEnabled("WEALTH", true);
    configured.backup = true;
    configured.emailIngest = true;

    const response = await POST(request("s3cret"));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect([...body.enqueued].sort()).toEqual(["BACKUP_RUN", "DOCUMENT_TEXT_BACKFILL", "EMAIL_INGEST", "PRICE_REFRESH", "REMINDER_CHECK"]);
    expect(body.triggered).toBe("REMINDER_CHECK");
    expect(body.status).toBe("DONE");
    expect(runBackup).toHaveBeenCalledTimes(1);
    expect(runEmailIngestion).toHaveBeenCalledTimes(1);
    expect(refreshAllPortfolioPrices).toHaveBeenCalledTimes(1);
    expect(runExpirationCheck).toHaveBeenCalledTimes(1);
    expect(await statuses()).toMatchObject({
      BACKUP_RUN: "DONE",
      EMAIL_INGEST: "DONE",
      PRICE_REFRESH: "DONE",
      REMINDER_CHECK: "DONE",
      // Low-priority catch-up work is left to the in-process runner.
      DOCUMENT_TEXT_BACKFILL: "PENDING",
    });
  });

  it("only runs what is configured on a plain install", async () => {
    const body = await (await POST(request("s3cret"))).json();
    expect(runExpirationCheck).toHaveBeenCalledTimes(1);
    expect(runBackup).not.toHaveBeenCalled();
    expect(runEmailIngestion).not.toHaveBeenCalled();
    expect(refreshAllPortfolioPrices).not.toHaveBeenCalled();
    expect(body.enqueued).not.toContain("BACKUP_RUN");
  });

  it("still runs the reminder check on every call, as it always has", async () => {
    await POST(request("s3cret"));
    resetCronOwedScans();
    await POST(request("s3cret"));
    expect(runExpirationCheck).toHaveBeenCalledTimes(2);
  });

  it("doesn't re-run a backup that isn't owed again on a second call", async () => {
    configured.backup = true;
    await POST(request("s3cret"));
    resetCronOwedScans();
    await POST(request("s3cret"));
    expect(runBackup).toHaveBeenCalledTimes(1);
  });

  it("runs each job once when two calls arrive together", async () => {
    await setModuleEnabled("WEALTH", true);
    configured.backup = true;
    const [a, b] = await Promise.all([POST(request("s3cret")), POST(request("s3cret"))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(runBackup).toHaveBeenCalledTimes(1);
    expect(refreshAllPortfolioPrices).toHaveBeenCalledTimes(1);
    expect(await db.prisma.backgroundJob.count({ where: { type: "BACKUP_RUN" } })).toBe(1);
  });
});
