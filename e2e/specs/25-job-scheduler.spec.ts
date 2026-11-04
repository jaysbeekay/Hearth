import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";
import { ADMIN_AUTH_FILE, BASE_URL, DATABASE_URL } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

// #250: /api/cron used to call runExpirationCheck() directly — a separate
// code path from the internal scheduled ticker (src/instrumentation.ts),
// which now enqueues the exact same REMINDER_CHECK job type this endpoint
// enqueues. Both go through the same DB-leased claim in
// src/lib/jobs/runner.ts, so this also proves two triggers racing on the
// same job type can't both run it — the same guarantee #249's sync
// idempotency tests already proved for a different table.

test("triggering /api/cron runs and reports the reminder check", async ({ request }) => {
  const res = await request.post(`${BASE_URL}/api/cron`, {
    headers: { "x-cron-secret": "e2e-cron-secret" },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.triggered).toBe("REMINDER_CHECK");
  // Usually this request's own enqueue wins the claim and runs it to
  // completion. Two other answers are the lease doing its job:
  // "ALREADY_PENDING" (a previous run's job was still queued) and "RUNNING"
  // (the built-in ticker, src/instrumentation.ts, claimed this request's job
  // first, so its runPendingJobs found nothing to claim). Then the check is
  // still in flight: wait for it to finish rather than pass on "in flight".
  expect(["DONE", "FAILED", "ALREADY_PENDING", "RUNNING"]).toContain(body.status);
  if (body.status === "DONE" || body.status === "FAILED") return;

  const db = createClient({ url: DATABASE_URL });
  try {
    await expect
      .poll(
        async () => {
          const { rows } = await db.execute(
            "SELECT status FROM background_jobs WHERE type = 'REMINDER_CHECK' ORDER BY createdAt DESC LIMIT 1",
          );
          return rows[0]?.status;
        },
        { timeout: 60_000 },
      )
      .toMatch(/^(DONE|FAILED)$/);
  } finally {
    db.close();
  }
});

test("two /api/cron triggers in quick succession don't double-enqueue the reminder check", async ({
  request,
}) => {
  const [a, b] = await Promise.all([
    request.post(`${BASE_URL}/api/cron`, { headers: { "x-cron-secret": "e2e-cron-secret" } }),
    request.post(`${BASE_URL}/api/cron`, { headers: { "x-cron-secret": "e2e-cron-secret" } }),
  ]);
  expect(a.ok()).toBe(true);
  expect(b.ok()).toBe(true);
  const [bodyA, bodyB] = await Promise.all([a.json(), b.json()]);

  // One of the two claimed the job and ran it; the other saw it already
  // PENDING/RUNNING (enqueueJobUnlessPending) and reported ALREADY_PENDING
  // instead of enqueueing a second one.
  const statuses = [bodyA.status, bodyB.status];
  expect(statuses).toContain("ALREADY_PENDING");
});

test("an unauthenticated /api/cron request is rejected", async ({ request }) => {
  const res = await request.post(`${BASE_URL}/api/cron`, {
    headers: { "x-cron-secret": "wrong-secret" },
  });
  expect(res.status()).toBe(401);
});
