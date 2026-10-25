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
  await expect(page.getByText("Move this contract to Trash?")).toBeVisible();
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
  const drawer = page.getByRole("dialog", { name: "Navigation menu" });
  // The menu button is server-rendered, so seeing it doesn't prove the
  // listener is attached yet. Repeat the gesture until hydration has caught
  // up; a swipe that lands first is simply ignored.
  await expect(async () => {
    await body.dispatchEvent("pointerdown", { pointerType: "touch", clientX: 5, clientY: 300 });
    for (let i = 1; i <= 8; i++) {
      await body.dispatchEvent("pointermove", { pointerType: "touch", clientX: 5 + i * 10, clientY: 300 });
    }
    await body.dispatchEvent("pointerup", { pointerType: "touch", clientX: 85, clientY: 300 });
    await expect(drawer).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
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

// #401 (regression of #348): nothing fixed, or stuck to the bottom edge, may
// sit over a tappable control at any scroll position. The bottom nav is the
// one bar allowed, since <main>'s bottom padding lets the end of every page
// scroll clear of it (checked separately below). Everything else (the old
// floating camera button and "Choose file" pill covered dashboard rows and
// Documents links mid-page) fails this check.
async function controlsCoveredByFixedUi(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const bottomNav = document.querySelector("nav.fixed.bottom-0");
    const fixed = [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => {
      const style = getComputedStyle(el);
      const pinnedToBottom = style.position === "sticky" && style.bottom !== "auto";
      if (style.position !== "fixed" && !pinnedToBottom) {
        return false;
      }
      if (bottomNav && (el === bottomNav || bottomNav.contains(el))) {
        return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && el.checkVisibility();
    });

    const covered: string[] = [];
    const controls = document.querySelectorAll<HTMLElement>(
      "main a[href], main button, main label[for], main select, main textarea, main input:not([type=hidden]):not(.sr-only)",
    );
    for (const control of controls) {
      const c = control.getBoundingClientRect();
      if (c.width <= 1 || c.height <= 1 || !control.checkVisibility()) {
        continue;
      }
      if (c.bottom <= 0 || c.top >= window.innerHeight) {
        continue;
      }
      for (const el of fixed) {
        if (el.contains(control)) {
          continue;
        }
        const f = el.getBoundingClientRect();
        const overlaps = c.left < f.right && c.right > f.left && c.top < f.bottom && c.bottom > f.top;
        if (overlaps) {
          const name = (control.getAttribute("aria-label") ?? control.textContent ?? "").trim().slice(0, 40);
          covered.push(`${control.tagName.toLowerCase()} "${name}" at y=${Math.round(c.top)} under ${el.tagName.toLowerCase()}.${el.className.toString().split(" ").slice(0, 3).join(".")}`);
        }
      }
    }
    return covered;
  });
}

// With the page scrolled to the end, the last control in <main> must sit
// fully above the bottom nav. This catches losing <main>'s bottom padding,
// which the per-offset check above deliberately ignores.
async function lastControlClearOfBottomNav(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const nav = document.querySelector("nav.fixed.bottom-0");
    if (!nav) {
      return { ok: false, detail: "bottom nav not found" };
    }
    const navTop = nav.getBoundingClientRect().top;
    let lowest: { bottom: number; name: string } | null = null;
    const controls = document.querySelectorAll<HTMLElement>(
      "main a[href], main button, main label[for], main select, main textarea, main input:not([type=hidden]):not(.sr-only)",
    );
    for (const control of controls) {
      const r = control.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1 || !control.checkVisibility()) {
        continue;
      }
      if (!lowest || r.bottom > lowest.bottom) {
        lowest = { bottom: r.bottom, name: (control.textContent ?? "").trim().slice(0, 40) };
      }
    }
    if (!lowest) {
      return { ok: true, detail: "no controls" };
    }
    return {
      ok: lowest.bottom <= navTop,
      detail: `"${lowest.name}" ends at y=${Math.round(lowest.bottom)}, nav starts at y=${Math.round(navTop)}`,
    };
  });
}

async function inboxCount(page: import("@playwright/test").Page) {
  const text = await page.getByRole("link", { name: /^Inbox/ }).textContent();
  return Number(/\((\d+)\)/.exec(text ?? "")?.[1] ?? 0);
}

test.describe("fixed mobile UI never covers controls (#401)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("no control on the dashboard or Documents pages is covered at any scroll offset, and Take photo saves to the Inbox", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();

    // Enough Due rows that the dashboard scrolls well past one screen even
    // when this spec runs on its own against the freshly seeded DB.
    const end = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    for (let i = 0; i < 6; i++) {
      await page.goto("/contracts/new");
      await page.locator("#title").fill(`Overlap Check Contract ${stamp}-${i}`);
      await page.locator("#provider").fill("Overlap Provider");
      await page.locator("#endDate").fill(end);
      await page.locator("main button[type=submit]").click();
      await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
    }

    // Camera capture is an in-flow header button now, on the dashboard and
    // on every Documents tab.
    for (const path of ["/dashboard", "/documents", "/documents/inbox"]) {
      await page.goto(path);
      await expect(page.locator("main label", { hasText: "Take photo" })).toBeVisible();
    }
    await page.goto("/documents");
    await expect(page.getByRole("link", { name: "Upload", exact: true })).toBeVisible();
    for (let i = 0; i < 2; i++) {
      const before = await inboxCount(page);
      await page.locator('main input[type="file"][accept="image/*"][capture]').setInputFiles({
        name: `overlap-photo-${stamp}-${i}.png`,
        mimeType: "image/png",
        // Unique trailing bytes, so these photos aren't flagged as
        // duplicates of each other in later specs' Inbox assertions.
        buffer: Buffer.concat([
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            "base64",
          ),
          Buffer.from(`${stamp}-${i}`),
        ]),
      });
      // Each capture must really land: the Inbox tab's count goes up by one
      // (the button refreshes the page after saving).
      await expect(page.getByRole("link", { name: /^Inbox/ })).toHaveText(`Inbox (${before + 1})`);
    }

    // The old floating controls are gone.
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Choose a file to upload" })).toHaveCount(0);

    for (const path of ["/dashboard", "/documents", "/documents/inbox"]) {
      // Fresh load, so no transient toast is on screen.
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const maxScroll = await page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight,
      );
      const covered: string[] = [];
      for (let y = 0; ; y = Math.min(y + 300, maxScroll)) {
        await page.evaluate((top) => {
          window.scrollTo(0, top);
        }, y);
        for (const hit of await controlsCoveredByFixedUi(page)) {
          covered.push(`${path} @ scroll ${y}: ${hit}`);
        }
        if (y >= maxScroll) {
          break;
        }
      }
      expect(covered).toEqual([]);

      const end = await lastControlClearOfBottomNav(page);
      expect(end.ok, `${path}: ${end.detail}`).toBe(true);
    }
  });

  test("read-only members see no upload controls, and /import sends them back to Documents", async ({
    browser,
  }) => {
    const email = `readonly-${Date.now()}@e2e.local`;
    const password = "E2eTestPassw0rd!23";

    const adminContext = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/settings/users");
    await adminPage.locator("#name").fill("Read-only Viewer");
    await adminPage.locator("#email").fill(email);
    await adminPage.locator("#password").fill(password);
    await adminPage.locator("form:has(#password) select#role").selectOption("READONLY");
    await adminPage.locator("form:has(#password) button[type=submit]").click();
    await expect(adminPage.locator("body")).toContainText(email);

    // Empty storage state: this file's test.use() would otherwise hand the
    // new context the admin session too.
    const viewerContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: { cookies: [], origins: [] },
    });
    const viewer = await viewerContext.newPage();
    await viewer.goto("/login");
    await viewer.locator('input[name="email"]').fill(email);
    await viewer.locator('input[name="password"]').fill(password);
    await viewer.locator("form button[type=submit]").click();
    await viewer.waitForURL(/\/dashboard/);

    for (const path of ["/dashboard", "/documents", "/documents/inbox"]) {
      await viewer.goto(path);
      await expect(viewer.locator("h1")).toBeVisible();
      await expect(viewer.locator("main label", { hasText: "Take photo" })).toHaveCount(0);
      await expect(viewer.locator('main input[type="file"][capture]')).toHaveCount(0);
      await expect(viewer.getByRole("link", { name: /^Upload( a document)?$/ })).toHaveCount(0);
    }

    await viewer.goto("/import");
    await expect(viewer).toHaveURL(/\/documents$/);
    await viewerContext.close();

    // Remove the extra account again so later specs see the usual household.
    await adminPage.goto("/settings/users");
    const row = adminPage.locator("li", { hasText: email });
    await row.getByRole("button", { name: /Remove .* from the household/ }).click();
    await adminPage.getByRole("button", { name: "Remove Read-only Viewer", exact: true }).click();
    await expect(adminPage.locator("body")).not.toContainText(email);
    await adminContext.close();
  });
});
