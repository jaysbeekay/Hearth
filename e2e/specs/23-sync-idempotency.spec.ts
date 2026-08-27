import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE, BASE_URL } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

function contractOp(id: string, title: string, extra: Record<string, string> = {}) {
  return {
    id,
    entity: "contract",
    operation: "create" as const,
    formValues: {
      title,
      category: "OTHER",
      provider: "Sync Test Provider",
      renewalType: "MANUAL_RENEWAL",
      ...extra,
    },
  };
}

async function postSync(request: import("@playwright/test").APIRequestContext, operations: unknown[]) {
  return request.post(`${BASE_URL}/api/sync`, {
    multipart: { operations: JSON.stringify(operations) },
  });
}

async function countByTitle(request: import("@playwright/test").APIRequestContext, title: string) {
  const res = await request.get(`${BASE_URL}/api/search?q=${encodeURIComponent(title)}`);
  const { groups } = (await res.json()) as { groups: Record<string, { title: string }[]> };
  return (groups.Contracts ?? []).filter((r) => r.title === title).length;
}

// #249: /api/sync accepted a client-generated operation id but never
// persisted it, so a lost response made the client resend — and re-execute
// — an operation that had already completed.

test("replaying a completed create is a no-op that returns the original result", async ({
  request,
}) => {
  const opId = `e2e-replay-${Date.now()}`;
  const title = "Sync Idempotency Replay Contract";
  const op = contractOp(opId, title);

  const first = await postSync(request, [op]);
  expect(first.ok()).toBe(true);
  expect((await first.json()).results).toEqual([{ id: opId, success: true }]);
  expect(await countByTitle(request, title)).toBe(1);

  // Same op id, same payload — as the client would resend after never
  // seeing the first response (dropped connection, tab closed mid-request).
  const second = await postSync(request, [op]);
  expect(second.ok()).toBe(true);
  expect((await second.json()).results).toEqual([{ id: opId, success: true }]);

  // The replay must not have created a second contract.
  expect(await countByTitle(request, title)).toBe(1);
});

test("replaying a failed operation returns the same error without retrying it", async ({
  request,
}) => {
  const opId = `e2e-replay-fail-${Date.now()}`;
  // Missing required "title" — fails validation both times, deterministically.
  const op = {
    id: opId,
    entity: "contract",
    operation: "create" as const,
    formValues: { category: "OTHER", provider: "Sync Test Provider", renewalType: "MANUAL_RENEWAL" },
  };

  const first = await postSync(request, [op]);
  const firstResult = (await first.json()).results[0];
  expect(firstResult.success).toBe(false);
  expect(firstResult.error).toBeTruthy();

  const second = await postSync(request, [op]);
  const secondResult = (await second.json()).results[0];
  expect(secondResult).toEqual(firstResult);
});

test("two concurrent requests for the same operation id only execute it once", async ({
  request,
}) => {
  const opId = `e2e-concurrent-${Date.now()}`;
  const title = "Sync Idempotency Concurrent Contract";
  const op = contractOp(opId, title);

  const [a, b] = await Promise.all([postSync(request, [op]), postSync(request, [op])]);
  const [resultA, resultB] = await Promise.all([
    a.json().then((j) => j.results[0]),
    b.json().then((j) => j.results[0]),
  ]);

  // Exactly one contract exists — the loser either waited for the winner's
  // outcome or got a transient "already syncing" error, never a duplicate.
  expect(await countByTitle(request, title)).toBe(1);

  const succeeded = [resultA, resultB].filter((r) => r.success);
  expect(succeeded.length).toBeGreaterThanOrEqual(1);
});

// The remaining acceptance criterion — "online and offline contract/product
// changes have identical reminder-log and cache-invalidation behaviour" — is
// satisfied by construction rather than exercised end-to-end here:
// entityHandlers.ts's contract/product `update` (the offline-sync path) and
// the online updateContract/updateProduct server actions both call the same
// updateContractCommand/updateProductCommand (src/lib/commands/), which is
// the single place reminder-log clearing on an endDate/warrantyEndDate
// change happens. There is no separate offline code path left to diverge.
