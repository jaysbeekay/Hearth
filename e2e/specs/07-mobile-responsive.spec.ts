import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE, viewport: { width: 375, height: 812 } });

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth - clientWidth).toBeLessThanOrEqual(1);
}

test("contract detail page with long field values doesn't overflow on a mobile viewport", async ({
  page,
}) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill("Mobile Overflow Regression Contract");
  await page.locator("#provider").fill("Regression Test Provider");
  await page
    .locator("#contractNumber")
    .fill("POLICY-AUSTRALIANHOMEANDCONTENTSINSURANCE-000123456789");
  await page
    .locator("#contactEmail")
    .fill("a.very.long.email.address.for.testing.overflow@some-extremely-long-domain-name.com.au");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/[^/]+$/);

  await expectNoHorizontalOverflow(page);
});

test("/spend page doesn't overflow on a mobile viewport", async ({ page }) => {
  await page.goto("/spend");
  await expectNoHorizontalOverflow(page);
});

test("DetailOverflowMenu renders as a full-width bottom sheet on mobile", async ({ page }) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill("Overflow Menu Test Contract");
  await page.locator("#provider").fill("Test Provider");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/[^/]+$/);

  const trigger = page.locator('button[aria-label="More actions"]');
  const triggerBox = await trigger.boundingBox();
  expect(triggerBox?.width).toBeGreaterThanOrEqual(44);
  expect(triggerBox?.height).toBeGreaterThanOrEqual(44);

  await trigger.click();

  const sheet = page.locator("div.fixed.inset-0.z-40");
  await expect(sheet).toBeVisible();
  const sheetPanel = sheet.locator("> div");
  const panelBox = await sheetPanel.boundingBox();
  expect(panelBox?.width).toBeGreaterThan(300);

  await expect(sheet.getByText("Delete", { exact: true })).toBeVisible();
});
