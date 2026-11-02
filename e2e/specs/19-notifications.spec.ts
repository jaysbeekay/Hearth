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

    // Expiring tomorrow (UTC) crosses every configured threshold (default
    // 30/14/7/1 days) at once, which the Reminder schedule collapses into a
    // single catch-up notification per channel. An already-*past* endDate
    // wouldn't fire at all — the scheduler only reminds ahead of expiry
    // (remaining >= 0), not after it. Tomorrow rather than today: the
    // household day follows the server's zone, which east of UTC can
    // already be tomorrow, making "today in UTC" yesterday.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await page.goto("/contracts/new");
    await page.locator("#title").fill("Webhook Notification Test Contract");
    await page.locator("#provider").fill("Test Provider");
    await page.locator("#endDate").fill(tomorrow);
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
    const contractPageUrl = page.url();

    const cronResponse = await request.post(`${BASE_URL}/api/cron`, {
      headers: { "x-cron-secret": "e2e-cron-secret" },
    });
    expect(cronResponse.ok()).toBe(true);

    await expect.poll(() => received !== null, { timeout: 10_000 }).toBe(true);
    const payload = JSON.parse(received!.body);
    expect(payload.event).toBe("contract.expiring");
    expect(payload.title).toBe("Webhook Notification Test Contract");
    // #352 — the payload links straight back to the record (APP_URL is set
    // to this server in the e2e environment).
    expect(payload.url).toBe(contractPageUrl);

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

// #388 — a rented Property's current Tenancy gets Reminders for its lease
// end, delivered like any other, linking to the Property.
test("a tenancy's lease end delivers a tenancy.expiring webhook and shows on the property", async ({
  page,
  request,
}) => {
  const bodies: string[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      bodies.push(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(200).end("OK");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    await page.goto("/settings/webhooks");
    await page.locator("#name").fill("E2E Lease Webhook");
    await page.locator("#url").fill(`http://127.0.0.1:${port}/lease`);
    await page.getByRole("button", { name: "Add webhook" }).click();
    await expect(page.locator("body")).toContainText("E2E Lease Webhook was added.");

    await page.goto("/home/new");
    await page.locator("#label").fill("Lease Reminder Flat");
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/home\/(?!new$)[^/]+$/);
    const propertyUrl = page.url();

    // Inside the 14-day threshold: one catch-up Reminder.
    const leaseEnd = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await page.goto(`${propertyUrl}/rental/agreements/new`);
    await page.locator("#weeklyRent").fill("600");
    await page.locator("#tenantName").fill("Sam Lee");
    await page.locator("#leaseEnd").fill(leaseEnd);
    // The thresholds are validated like a Contract's.
    await page.locator("#reminderDaysBefore").fill("soon");
    await page.locator("main button[type=submit]").click();
    await expect(page.locator("body")).toContainText("Use a comma-separated list of non-negative numbers");
    // Blank means the household default.
    await page.locator("#reminderDaysBefore").fill("");
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/rental$/);

    const cronResponse = await request.post(`${BASE_URL}/api/cron`, {
      headers: { "x-cron-secret": "e2e-cron-secret" },
    });
    expect(cronResponse.ok()).toBe(true);

    const leasePayload = () =>
      bodies.map((body) => JSON.parse(body)).find((payload) => payload.event === "tenancy.expiring");
    await expect.poll(() => leasePayload() != null, { timeout: 10_000 }).toBe(true);
    const payload = leasePayload();
    expect(payload).toMatchObject({
      kind: "tenancy",
      title: "Lease Reminder Flat",
      endDate: leaseEnd,
      url: propertyUrl,
    });
    // The tenant's name never leaves the household by webhook.
    expect(payload).not.toHaveProperty("detail");
    expect(payload.daysRemaining).toBeGreaterThanOrEqual(9);
    expect(payload.daysRemaining).toBeLessThanOrEqual(11);

    await page.goto(propertyUrl);
    const card = page.locator("div.rounded-lg", { has: page.getByRole("heading", { name: "Lease reminders" }) });
    await expect(card).toBeVisible();
    await expect(card).toContainText("1d, 7d, 14d, 30d");
    // The delivery attempt is on the card. (The first test's endpoint is
    // gone, so the webhook channel reports a failure alongside this send.)
    await expect(card).toContainText(/\(webhook\)|via webhook/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
