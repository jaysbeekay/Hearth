import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";
import { openFormSections } from "../formSections";

test.use({ storageState: ADMIN_AUTH_FILE });

// #367 — Spend warns about the same contracts the dashboard leaves out,
// leads with the category breakdown, folds the timeline, and projects the
// next 12 months instead of monthly × 12.

test("Spend warns about a cost with no billing frequency and leads with categories", async ({ page }) => {
  // A counted monthly contract, so the category breakdown renders even when
  // this spec runs alone (#521 review).
  await page.goto("/contracts/new");
  await page.locator("#title").fill(`Spend Counted ${Date.now()}`);
  await page.locator("#category").selectOption("UTILITY");
  await page.locator("#provider").fill("Spend Provider");
  await page.locator("#cost").fill("25");
  await page.selectOption("#billingFrequency", "MONTHLY");
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator("main button[type=submit]").click(),
  ]);

  await page.goto("/contracts/new");
  await page.locator("#title").fill(`Spend No Frequency ${Date.now()}`);
  await page.locator("#category").selectOption("UTILITY");
  await page.locator("#provider").fill("Spend Provider");
  await page.locator("#cost").fill("40");
  // #361 — a cost defaults the frequency to Monthly; "" picks Not set back.
  await page.selectOption("#billingFrequency", "");
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator("main button[type=submit]").click(),
  ]);

  await page.goto("/spend");
  const main = page.locator("main");
  await expect(main.getByText(/contracts? (has|have) a cost but no billing frequency/)).toBeVisible();
  await expect(main.getByRole("link", { name: "Set the billing frequency" })).toHaveAttribute(
    "href",
    "/contracts?missing=details",
  );
  await expect(main.getByText("Next 12 months", { exact: true })).toBeVisible();
  await expect(main.getByText("Annual projection")).toHaveCount(0);
  // Nothing in the e2e data is tax-deductible, so its tile stays hidden.
  await expect(main.getByText("Tax-deductible / mo", { exact: true })).toHaveCount(0);

  // The category breakdown comes before the timeline.
  const categories = main.getByRole("heading", { name: "Recurring cost by category" });
  const overTime = main.getByRole("heading", { name: "Recurring cost over time" });
  await expect(categories).toBeVisible();
  const categoriesFirst = await categories.evaluate(
    (heading, other) => Boolean(heading.compareDocumentPosition(other as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
    await overTime.elementHandle(),
  );
  expect(categoriesFirst).toBe(true);

  // The timeline is folded until opened, and stays open on the Yearly toggle.
  const timeline = main.locator("details", { hasText: "Recurring cost over time" });
  await expect(timeline).not.toHaveAttribute("open", "");
  await timeline.locator("summary").click();
  await timeline.getByRole("link", { name: "Yearly" }).click();
  await page.waitForURL(/view=yearly/);
  await expect(main.locator("details", { hasText: "Recurring cost over time" })).toHaveAttribute("open", "");
  await expect(main.getByText("Last 5 years", { exact: true })).toBeVisible();
});

test("Spend lists manual renewals ending within the year beside Next 12 months", async ({ page }) => {
  const title = `Spend Manual Renewal ${Date.now()}`;
  const end = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  await page.goto("/contracts/new");
  await page.locator("#title").fill(title);
  await page.locator("#category").selectOption("UTILITY");
  await openFormSections(page);
  await page.locator("#provider").fill("Spend Provider");
  await page.locator("#cost").fill("30");
  await page.selectOption("#billingFrequency", "MONTHLY");
  await page.locator("#endDate").fill(end);
  await page.selectOption("#renewalType", "MANUAL_RENEWAL");
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator("main button[type=submit]").click(),
  ]);
  const contractUrl = new URL(page.url()).pathname;

  await page.goto("/spend");
  const renewals = page.locator("main details", { hasText: "(renew manually)" });
  await expect(renewals.locator("summary")).toContainText(/^\+ .+ from \d+ contracts? ending within 12 months/);
  await renewals.locator("summary").click();
  await expect(renewals.getByRole("link", { name: new RegExp(title) })).toHaveAttribute("href", contractUrl);
  await expect(renewals.getByText(/if each is renewed at its current price/)).toBeVisible();
});
