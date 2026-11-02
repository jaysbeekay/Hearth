import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

// #351 — a contract with a notice period counts down to the last day to give
// notice, not to its end date.

test.use({ storageState: ADMIN_AUTH_FILE });

/** A Due policy label such as "Cancel by 4 Nov" or "Ends 3 Dec 2027". */
const DAY_LABEL = (verb: string) => new RegExp(`^${verb} \\d{1,2} [A-Z][a-z]{2}( \\d{4})?$`);

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

  // #384 — the banner shows the Due policy's label for the notice deadline;
  // #405 — the header badge would only repeat it, so it's hidden.
  await expect(page.getByText(/^Cancel by .+ — 10 days left\.$/)).toBeVisible();
  await expect(page.getByText(DAY_LABEL("Cancel by"))).toHaveCount(0);
  await expect(page.getByText(/30 days · give notice by /)).toBeVisible();

  await page.goto("/contracts?due=soon");
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

  await expect(page.getByText(DAY_LABEL("Ends"))).toBeVisible();
  await expect(page.getByText(/give notice/i)).toHaveCount(0);
});
