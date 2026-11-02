import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";
import { openFormSections } from "../formSections";

test.use({ storageState: ADMIN_AUTH_FILE });

// #413 — clearing an optional field on an edit form clears it. The schemas
// parse a blank field to undefined, which Prisma used to skip, so the old
// value survived the save. The end date drives Missing key details, so the
// cleared Contract has to show up there too.
test("clearing a Contract's end date on the edit form clears it", async ({ page }) => {
  const title = `Clear Fields Contract ${Date.now()}`;

  await page.goto("/contracts/new");
  await page.locator("#title").fill(title);
  await page.locator("#category").selectOption("OTHER");
  await openFormSections(page);
  await page.locator("#provider").fill("Clear Fields Provider");
  await page.locator("#endDate").fill("2030-06-30");
  await page.locator("#cost").fill("42");
  await page.selectOption("#billingFrequency", "MONTHLY");
  await page.locator("#notes").fill("Notes to clear");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
  const id = page.url().split("/").pop()!;

  // Complete to begin with: not missing key details.
  await page.goto("/contracts?missing=details");
  await expect(page.locator("main")).not.toContainText(title);

  await page.goto(`/contracts/${id}/edit`);
  await expect(page.locator("#endDate")).toHaveValue("2030-06-30");
  await page.locator("#endDate").fill("");
  await page.locator("#notes").fill("");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(new RegExp(`/contracts/${id}$`));
  await expect(page.locator("main")).not.toContainText("Notes to clear");

  await page.goto(`/contracts/${id}/edit`);
  await expect(page.locator("#endDate")).toHaveValue("");
  await expect(page.locator("#notes")).toHaveValue("");
  // Untouched fields are kept.
  await expect(page.locator("#cost")).toHaveValue("42");
  await expect(page.locator("#billingFrequency")).toHaveValue("MONTHLY");

  await page.goto("/contracts?missing=details");
  const row = page.locator("a", { hasText: title });
  await expect(row).toBeVisible();
  await expect(row.getByText("No end date", { exact: true }).last()).toBeVisible();
});
