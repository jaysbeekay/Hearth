import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

// #351 — a contract with a notice period counts down to the last day to give
// notice, not to its end date.

test.use({ storageState: ADMIN_AUTH_FILE });

function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test("an auto-renewing contract with a notice period counts down to the notice deadline", async ({ page }) => {
  const title = `Notice Period Contract ${Date.now()}`;
  await page.goto("/contracts/new");
  await page.locator("#title").fill(title);
  await page.locator("#provider").fill("Notice Provider");
  await page.locator("#endDate").fill(isoInDays(40));
  await page.selectOption("#renewalType", "AUTO_RENEW");
  await page.locator("#noticePeriodDays").fill("30");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

  await expect(page.getByText("10d to give notice")).toBeVisible();
  await expect(page.getByText(/Give notice by .+ — 10 days left\./)).toBeVisible();
  await expect(page.getByText(/30 days · give notice by /)).toBeVisible();

  await page.goto("/contracts?expiring=30");
  await expect(page.getByText(title)).toBeVisible();

  await page.goto("/calendar");
  await expect(page.getByText("Last day to give notice · Notice Provider")).toBeVisible();
});

test("a fixed-term contract ignores its notice period", async ({ page }) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill(`Fixed Term Contract ${Date.now()}`);
  await page.locator("#provider").fill("Fixed Provider");
  await page.locator("#endDate").fill(isoInDays(40));
  await page.selectOption("#renewalType", "FIXED_TERM");
  await page.locator("#noticePeriodDays").fill("30");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

  await expect(page.getByText("40d left")).toBeVisible();
  await expect(page.getByText(/give notice/i)).toHaveCount(0);
});
