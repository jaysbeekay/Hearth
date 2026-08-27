import http from "http";
import type { AddressInfo } from "net";
import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE, BASE_URL } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

// #263: the notification scheduler normally only runs on its own cron
// schedule, but /api/cron (gated on CRON_SECRET, set to "e2e-cron-secret" in
// playwright.config.ts for exactly this purpose) triggers the same
// runExpirationCheck() on demand — a deterministic way to exercise the real
// delivery pipeline instead of waiting on a timer or re-testing scheduling
// logic that's already unit-tested (tests/unit/thresholds.test.ts).
test("crossing a reminder threshold delivers a webhook notification", async ({ page, request }) => {
  let received: { body: string } | null = null;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      received = { body: Buffer.concat(chunks).toString("utf8") };
      res.writeHead(200).end("OK");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const webhookUrl = `http://127.0.0.1:${port}/hook`;

  try {
    await page.goto("/settings/webhooks");
    await page.locator("#name").fill("E2E Test Webhook");
    await page.locator("#url").fill(webhookUrl);
    await page.getByRole("button", { name: "Add webhook" }).click();
    await expect(page.locator("body")).toContainText("E2E Test Webhook was added.");

    // Expiring today crosses every configured threshold (default
    // 30/14/7/1 days) at once, which the dedup logic in thresholds.ts
    // collapses into a single catch-up notification per channel. An
    // already-*past* endDate wouldn't fire at all — the scheduler only
    // reminds ahead of expiry (remaining >= 0), not after it.
    const today = new Date().toISOString().slice(0, 10);
    await page.goto("/contracts/new");
    await page.locator("#title").fill("Webhook Notification Test Contract");
    await page.locator("#provider").fill("Test Provider");
    await page.locator("#endDate").fill(today);
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

    const cronResponse = await request.post(`${BASE_URL}/api/cron`, {
      headers: { "x-cron-secret": "e2e-cron-secret" },
    });
    expect(cronResponse.ok()).toBe(true);

    await expect.poll(() => received !== null, { timeout: 10_000 }).toBe(true);
    const payload = JSON.parse(received!.body);
    expect(payload.event).toBe("contract.expiring");
    expect(payload.title).toBe("Webhook Notification Test Contract");

    await page.goto("/settings/webhooks");
    await expect(page.locator("body")).toContainText("E2E Test Webhook");
    await expect(page.locator("body")).toContainText(/success|delivered|200/i);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("the test reminder button reports no delivery channel when email/ntfy aren't configured", async ({
  page,
}) => {
  // sendTestReminder only exercises email/ntfy (see src/lib/actions/reminders.ts)
  // — a configured webhook endpoint doesn't count as a channel for it, so
  // this stays accurate even after the webhook test above runs first.
  await page.goto("/contracts/new");
  await page.locator("#title").fill("Reminder Button Test Contract");
  await page.locator("#provider").fill("Test Provider");
  const end = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  await page.locator("#endDate").fill(end);
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

  await expect(page.getByRole("heading", { name: "Reminder health", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Send test reminder" }).click();
  await expect(page.locator("body")).toContainText("No delivery channel is configured yet");
});

test("the webhooks settings page lists configured endpoints", async ({ page }) => {
  await page.goto("/settings/webhooks");
  await expect(page.getByRole("heading", { name: "Webhooks", exact: true })).toBeVisible();
  await expect(page.locator("body")).toContainText("E2E Test Webhook");
});
