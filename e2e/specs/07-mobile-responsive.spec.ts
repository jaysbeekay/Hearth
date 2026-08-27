import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE, viewport: { width: 375, height: 812 }, hasTouch: true });

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
  // Exclude "new" itself: we're already on /contracts/new when this is
  // called, which a bare /\/contracts\/[^/]+$/ also matches — so without the
  // exclusion this resolves instantly instead of waiting for the real
  // post-submit redirect, and the next step runs against a page whose create
  // request may still be in flight (see 07-mobile-responsive's swipe test,
  // which failed exactly this way: the created contract never showed up on
  // /contracts because the request was aborted mid-navigation).
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

  await expectNoHorizontalOverflow(page);
});

test("/assistant page doesn't overflow on a mobile viewport", async ({ page }) => {
  await page.goto("/assistant");
  await expectNoHorizontalOverflow(page);
  await expect(page.locator("body")).toContainText("Assistant");
});

test("/documents page doesn't overflow on a mobile viewport", async ({ page }) => {
  await page.goto("/documents");
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
  // Exclude "new" itself — see the test above for why a bare
  // /\/contracts\/[^/]+$/ resolves instantly here instead of waiting.
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

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

test("swiping a contract card left reveals a delete action, which still uses the standard confirm dialog", async ({
  page,
}) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill("Swipe Test Contract");
  await page.locator("#provider").fill("Swipe Provider");
  await page.locator("main button[type=submit]").click();
  // Exclude "new" itself: we're already on /contracts/new when this is
  // called, which a bare /\/contracts\/[^/]+$/ also matches — so without the
  // exclusion this resolved instantly instead of waiting for the real
  // post-submit redirect, and the next line navigated away while the create
  // request was still in flight. That's exactly why this test flaked: the
  // contract was never actually created (server-side "Error: aborted /
  // ECONNRESET" from the interrupted POST), so it never showed up on
  // /contracts and the boundingBox() below timed out waiting for it.
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

  await page.goto("/contracts");
  const card = page.locator("a", { hasText: "Swipe Test Contract" }).first();
  const box = await card.boundingBox();
  if (!box) throw new Error("Contract card not found");

  const startX = box.x + box.width - 10;
  const startY = box.y + box.height / 2;
  await card.dispatchEvent("pointerdown", { pointerType: "touch", clientX: startX, clientY: startY });
  for (let i = 1; i <= 10; i++) {
    await card.dispatchEvent("pointermove", {
      pointerType: "touch",
      clientX: startX - i * 12,
      clientY: startY,
    });
  }
  await card.dispatchEvent("pointerup", { pointerType: "touch", clientX: startX - 120, clientY: startY });

  const deleteBtn = page.getByRole("button", { name: "Delete Swipe Test Contract" });
  await expect(deleteBtn).toBeVisible();

  await deleteBtn.click();
  await expect(page.getByText("Delete this contract and all its documents")).toBeVisible();
  await page.getByRole("button", { name: "Delete contract" }).click();
  await expect(page.getByText("Swipe Test Contract")).toHaveCount(0);
});

test("swiping from the left screen edge opens the navigation drawer, and the menu button does too", async ({
  page,
}) => {
  await page.goto("/dashboard");

  // The edge-swipe listener is attached by MobileNavDrawer's useEffect, so it
  // doesn't exist until the client bundle has hydrated. Dispatching straight
  // after goto() raced that and intermittently sent the gesture into a page
  // with no handler. The menu button comes from the same client component, so
  // waiting for it is a proxy for "that tree is interactive".
  await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeVisible();

  const body = page.locator("body");
  await body.dispatchEvent("pointerdown", { pointerType: "touch", clientX: 5, clientY: 300 });
  for (let i = 1; i <= 8; i++) {
    await body.dispatchEvent("pointermove", { pointerType: "touch", clientX: 5 + i * 10, clientY: 300 });
  }
  await body.dispatchEvent("pointerup", { pointerType: "touch", clientX: 85, clientY: 300 });

  const drawer = page.getByRole("dialog", { name: "Navigation menu" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Contracts" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  // A swipe starting further from the edge (past EDGE_ZONE) must not open it.
  await body.dispatchEvent("pointerdown", { pointerType: "touch", clientX: 120, clientY: 300 });
  for (let i = 1; i <= 8; i++) {
    await body.dispatchEvent("pointermove", { pointerType: "touch", clientX: 120 + i * 10, clientY: 300 });
  }
  await body.dispatchEvent("pointerup", { pointerType: "touch", clientX: 200, clientY: 300 });
  await expect(drawer).toBeHidden();

  // The visible menu button is the reliable fallback trigger.
  await page.locator('button[aria-label="Open navigation menu"]').click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "Contracts" }).click();
  await page.waitForURL(/\/contracts$/);
  await expect(drawer).toBeHidden();
});
