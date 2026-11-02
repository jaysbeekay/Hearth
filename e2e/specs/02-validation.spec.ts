import fs from "fs";
import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE, FIXTURES_FILE, type Fixtures } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

let newSegmentUrl: string;

test.beforeAll(() => {
  const { tripAId } = JSON.parse(fs.readFileSync(FIXTURES_FILE, "utf8")) as Fixtures;
  newSegmentUrl = `/travel/${tripAId}/segments/new`;
});

const submit = (page: import("@playwright/test").Page) =>
  page.locator('form:has(select[name="type"]) button[type="submit"]');

test("negative cost is rejected server-side even with client validation bypassed", async ({ page }) => {
  await page.goto(newSegmentUrl);
  await page.locator('select[name="type"]').selectOption("ACTIVITY");
  await page.locator('input[name="title"]').fill("Negative Cost Test");

  // <input type="number" min={0}> blocks this in the browser before any
  // request fires. Strip it so the request actually reaches the server,
  // proving the Zod schema enforces the same constraint independently.
  const cost = page.locator('input[name="cost"]');
  await cost.evaluate((el: HTMLInputElement) => {
    el.removeAttribute("min");
    el.type = "text";
  });
  await cost.fill("-50");

  await submit(page).click();
  await expect(page.locator("body")).not.toContainText("Negative Cost Test");
});

test("reversed date range is rejected with a cross-field error", async ({ page }) => {
  await page.goto(newSegmentUrl);
  await page.locator('select[name="type"]').selectOption("LODGING");
  await page.locator('input[name="title"]').fill("Reversed Dates Test");
  await page.locator('input[name="startDate"]').fill("2026-09-10");
  await page.locator('input[name="endDate"]').fill("2026-09-01");
  await submit(page).click();
  await expect(page.locator("body")).toContainText("can't be before");

  // Failing again with the same error still brings it into view (#514 review).
  const alert = page.getByRole("alert").filter({ hasText: "can't be before" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize({ width: 1280, height: 400 });
  await expect(alert).not.toBeInViewport();
  await submit(page).click();
  await expect(alert).toBeInViewport();
});

test("XSS-shaped input is escaped, not executed", async ({ page }) => {
  let dialogFired = false;
  page.on("dialog", async (dialog) => {
    dialogFired = true;
    await dialog.dismiss();
  });

  await page.goto(newSegmentUrl);
  await page.locator('select[name="type"]').selectOption("ACTIVITY");
  const payload = "<script>alert(1)</script>";
  await page.locator('input[name="title"]').fill(payload);
  await page.locator('input[name="provider"]').fill(payload);
  await page.locator('input[name="location"]').fill(payload);
  await page.locator('textarea[name="notes"]').fill(payload);
  await submit(page).click();
  await page.waitForLoadState("networkidle");

  expect(await page.content()).not.toContain("<script>alert(1)</script>");
  expect(dialogFired).toBe(false);
});
