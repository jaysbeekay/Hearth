import fs from "fs";
import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE, FIXTURES_FILE, type Fixtures } from "../env";

// #427 — Trip segments (like Rental statements, Trades, Tenancies and
// Property valuations) go to Trash instead of being deleted outright:
// "Moved to Trash · Undo", listed in Settings → Trash, restorable from
// there, and deleted for good only from there.

test.use({ storageState: ADMIN_AUTH_FILE });

let tripUrl: string;

test.beforeAll(() => {
  const { tripAId } = JSON.parse(fs.readFileSync(FIXTURES_FILE, "utf8")) as Fixtures;
  tripUrl = `/travel/${tripAId}`;
});

async function addSegment(page: Page, title: string) {
  await page.goto(`${tripUrl}/segments/new`);
  await page.locator('select[name="type"]').selectOption("LODGING");
  await page.locator('input[name="title"]').fill(title);
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(`**${tripUrl}`);
  await expect(page.locator("body")).toContainText(title);
}

async function deleteSegment(page: Page, title: string) {
  const row = page.locator("div.rounded-xl.border.border-border.bg-surface", { hasText: title });
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Settings → Trash");
  await expect(dialog).not.toContainText("can't be undone");
  await dialog.getByRole("button", { name: "Move to Trash" }).click();
}

test.describe.serial("Trip segments go to Trash", () => {
  const title = `Trash stay ${Date.now()}`;

  test("deleting one offers Undo, which brings it back", async ({ page }) => {
    await addSegment(page, title);
    await deleteSegment(page, title);

    const toast = page.getByRole("status");
    await expect(toast).toContainText("Moved to Trash.");
    await expect(page.locator("main")).not.toContainText(title);

    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("main")).toContainText(title);
  });

  test("a deleted one is listed in Trash and can be restored from there", async ({ page }) => {
    await page.goto(tripUrl);
    await deleteSegment(page, title);
    await expect(page.getByRole("status")).toContainText("Moved to Trash.");

    await page.goto("/settings/trash");
    const row = page.locator("li", { hasText: title });
    await expect(row).toContainText("Trip segment");
    await row.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByRole("status")).toContainText("Restored.");

    await page.goto(tripUrl);
    await expect(page.locator("main")).toContainText(title);
  });

  test("it's only deleted for good from Trash", async ({ page }) => {
    await page.goto(tripUrl);
    await deleteSegment(page, title);
    await expect(page.getByRole("status")).toContainText("Moved to Trash.");

    await page.goto("/settings/trash");
    const row = page.locator("li", { hasText: title });
    await row.getByRole("button", { name: "Delete permanently" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete permanently" }).click();
    await expect(page.locator("body")).not.toContainText(title);

    await page.goto(tripUrl);
    await expect(page.locator("main")).not.toContainText(title);
  });
});
