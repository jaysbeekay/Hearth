import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE, BASE_URL } from "../env";

// Regression coverage for the October 2026 UX-review quick wins (#368,
// #370, #371). #352's reminder content is unit-tested
// (tests/unit/reminderContent.test.ts) and its webhook link is asserted in
// 19-notifications.

test.use({ storageState: ADMIN_AUTH_FILE });

async function createContract(page: Page, title: string): Promise<string> {
  await page.goto("/contracts/new");
  await page.locator("#title").fill(title);
  await page.locator("#provider").fill("Quick Wins Provider");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
  return new URL(page.url()).pathname;
}

test("#368: a calendar feed can be created from Upcoming", async ({ page }) => {
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Subscribe in your calendar" }).click();

  const dialog = page.getByRole("dialog", { name: "Calendar feed" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Create calendar feed|Generate new URL/ }).click();

  const feedUrl = dialog.locator("input[readonly]");
  await expect(feedUrl).toHaveValue(/\/api\/ical\?token=/);
  expect((await feedUrl.inputValue()).startsWith(`${BASE_URL}/api/ical?token=`)).toBe(true);
  const webcal = dialog.getByRole("link", { name: "Open in your calendar app" });
  await expect(webcal).toHaveAttribute("href", /^webcal:\/\/localhost:\d+\/api\/ical\?token=/);

  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
});

test("#370: contract status lives in the overflow menu, not the header", async ({ page }) => {
  await createContract(page, `Status Menu Contract ${Date.now()}`);

  const header = page.locator("main h1").locator("xpath=../..");
  await expect(header.getByRole("button", { name: "Mark as cancelled", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("dialog", { name: "More actions", exact: true }).getByRole("button", { name: "Mark as cancelled", exact: true }).first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Mark as cancelled" }).click();
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
});

test("#371: deleting a contract from its page can be undone", async ({ page }) => {
  const title = `Undo Delete Contract ${Date.now()}`;
  const path = await createContract(page, title);

  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("dialog", { name: "More actions", exact: true }).getByRole("button", { name: "Delete" }).first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForURL(/\/contracts$/);

  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await page.waitForURL((url) => url.pathname === path);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
});
