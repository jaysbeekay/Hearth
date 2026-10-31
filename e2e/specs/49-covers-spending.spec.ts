import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

// #456 - a Registration Contract is a Contract like any other for cost, so
// it shows up in Spending under its own category.
test("a Registration contract's cost shows in Spending", async ({ page }) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill("Covers Spend Rego");
  await page.locator("#provider").fill("Transport Dept");
  await page.locator("#category").selectOption("REGISTRATION");
  await page.locator("#cost").fill("840");
  await page.locator("#billingFrequency").selectOption("ANNUALLY");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

  await page.goto("/spend");
  await expect(page.getByText("Vehicle registration").first()).toBeVisible();
});
