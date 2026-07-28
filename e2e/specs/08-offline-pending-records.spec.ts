import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

// Overrides the read-only navigator.onLine property to always report false,
// on every page/navigation — exercises the app's own offline-queueing
// decision (`!navigator.onLine` in makeOfflineAwareAction) without blocking
// real network traffic, which would also break Next.js's client-side
// navigation and isn't what this spec is testing.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, "onLine", { get: () => false });
  });
});

test("a contract created offline can be edited and discarded before it syncs", async ({ page }) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill("Offline Pending Contract");
  await page.locator("#provider").fill("Offline Provider");
  await page.locator("main button[type=submit]").click();

  await page.goto("/contracts");
  await expect(page.getByText("Pending sync").first()).toBeVisible();
  await expect(page.getByText("Offline Pending Contract").first()).toBeVisible();

  // Edit: fields should prefill from the queued operation, and saving must
  // update it in place rather than enqueueing a second entry.
  await page.getByRole("link", { name: "Edit" }).first().click();
  await expect(page).toHaveURL(/pendingOpId=/);
  await expect(page.locator("#title")).toHaveValue("Offline Pending Contract");
  await expect(page.locator("#provider")).toHaveValue("Offline Provider");

  await page.locator("#provider").fill("Edited Offline Provider");
  await page.locator("main button[type=submit]").click();
  await expect(page).toHaveURL(/\/contracts$/);
  await expect(page.getByText("Edited Offline Provider").first()).toBeVisible();
  await expect(page.getByText("Pending sync")).toHaveCount(1);

  // Discard: removes the queued operation with no server-side row ever created.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Discard" }).first().click();
  await expect(page.getByText("Pending sync")).toHaveCount(0);

  await page.goto("/contracts?q=Offline");
  await expect(page.locator("body")).toContainText("No contracts match your search");
});
