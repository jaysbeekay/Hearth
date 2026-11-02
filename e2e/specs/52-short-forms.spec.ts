import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

// #361 — shorter record forms: optional fields fold away, Category is
// required for real, and a cost defaults its frequency to Monthly.

test("the new-contract form fits in two phone screens and folds the optional fields", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/contracts/new");
  const moreDetails = page.locator("details[data-form-section]", { hasText: "More details" });
  await expect(moreDetails).not.toHaveAttribute("open", "");
  await expect(page.locator("#contractNumber")).toBeHidden();
  await expect(page.locator("#reminderDaysBefore")).toBeHidden();

  const formHeight = await page.locator("main form").evaluate((el) => el.getBoundingClientRect().height);
  expect(formHeight).toBeLessThanOrEqual(844 * 2);

  await moreDetails.locator("summary").click();
  await expect(page.locator("#contractNumber")).toBeVisible();
});

test("a contract can't be saved without choosing a category", async ({ page }) => {
  await page.goto("/contracts/new");
  await expect(page.locator("#category")).toHaveValue("");
  await page.locator("#title").fill(`No Category ${Date.now()}`);
  await page.locator("#provider").fill("No Category Provider");
  await page.locator("main button[type=submit]").click();
  // The browser blocks the submit on the field itself.
  await expect(page).toHaveURL(/\/contracts\/new$/);
  expect(await page.locator("#category").evaluate((el: HTMLSelectElement) => el.validity.valueMissing)).toBe(true);
});

test("a cost defaults its billing frequency to Monthly until one is chosen", async ({ page }) => {
  await page.goto("/contracts/new");
  await page.locator("#cost").fill("25");
  await expect(page.locator("#billingFrequency")).toHaveValue("MONTHLY");
  await page.locator("#billingFrequency").selectOption("ANNUALLY");
  await page.locator("#cost").fill("300");
  await expect(page.locator("#billingFrequency")).toHaveValue("ANNUALLY");
});

test("editing a contract opens the sections that hold its values", async ({ page }) => {
  const title = `Sections Open ${Date.now()}`;
  await page.goto("/contracts/new");
  await page.locator("#title").fill(title);
  await page.locator("#category").selectOption("UTILITY");
  await page.locator("#provider").fill("Sections Provider");
  await page.locator("details[data-form-section]", { hasText: "More details" }).locator("summary").click();
  await page.locator("#contractNumber").fill("SEC-123");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

  await page.goto(`${new URL(page.url()).pathname}/edit`);
  await expect(page.locator("#contractNumber")).toBeVisible();
  await expect(page.locator("#contractNumber")).toHaveValue("SEC-123");
  // No thresholds of its own: Reminders stays folded.
  await expect(page.locator("#reminderDaysBefore")).toBeHidden();
});
