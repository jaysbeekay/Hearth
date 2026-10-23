import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE, MEMBER_EMAIL, MEMBER_PASSWORD } from "../env";

// Regression coverage for the October 2026 UX-review bug batch (#338,
// #341–#343, #346, #348–#350). #344 (passkey button only when a passkey
// exists) isn't asserted here: 15-security-factors registers a passkey
// earlier in this single-worker run, so the "hidden" state isn't
// reachable from this file.

test.describe("signed out", () => {
  test("#341: signing in returns to the page that required it", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fsettings$/);

    await page.locator('input[name="email"]').fill(MEMBER_EMAIL);
    await page.locator('input[name="password"]').fill(MEMBER_PASSWORD);
    await page.locator("form button[type=submit]").click();
    await expect(page).toHaveURL(/\/settings$/);
    await context.close();
  });

  test("#341: an off-site callbackUrl is ignored", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/login?callbackUrl=https%3A%2F%2Fevil.example%2Fphish");
    await page.locator('input[name="email"]').fill(MEMBER_EMAIL);
    await page.locator('input[name="password"]').fill(MEMBER_PASSWORD);
    await page.locator("form button[type=submit]").click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await context.close();
  });

  test("#343: the app icon loads without a session", async ({ request }) => {
    const response = await request.get("/icon.svg", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/svg+xml");
  });
});

test.describe("signed in", () => {
  test.use({ storageState: ADMIN_AUTH_FILE });

  test("#342: Escape closes the dashboard Add picker and returns focus", async ({ page }) => {
    await page.goto("/dashboard");
    const addButton = page.getByRole("button", { name: "Add", exact: true });
    await addButton.click();
    const dialog = page.getByRole("dialog", { name: "What are you adding?" });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(addButton).toBeFocused();
  });

  test("#346: document-extraction settings don't pre-select a cloud provider", async ({ page }) => {
    await page.goto("/settings/app");
    await expect(page.locator("#provider")).toHaveValue("");
    await expect(page.getByText(/Documents will be sent to/)).toHaveCount(0);
    await expect(page.locator("#apiKey")).toHaveCount(0);

    await page.selectOption("#provider", "ANTHROPIC");
    await expect(page.getByText("Documents will be sent to Anthropic Claude for processing.")).toBeVisible();
  });

  test("#349 #350: warranty form hides disabled barcode lookup; upload has one labelled type select", async ({
    page,
  }) => {
    await page.goto("/products/new");
    await expect(page.getByRole("button", { name: "Look up product info" })).toHaveCount(0);

    const description = `UX batch warranty ${Date.now()}`;
    await page.locator("#description").fill(description);
    await page.locator("main button[type=submit]").click();
    await expect(page.getByRole("heading", { name: description })).toBeVisible();

    const documents = page.locator("#documents");
    await expect(documents.locator('select[name="kind"]')).toHaveCount(0);
    await expect(documents.locator("select")).toHaveCount(1);
    await expect(documents.getByLabel("Document type")).toBeVisible();
  });

  test("#338: the CSP allows the default OpenStreetMap tile host", async ({ page }) => {
    const response = await page.goto("/dashboard");
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("img-src 'self' data: blob: https://tile.openstreetmap.org");
    expect(csp).not.toContain("cartocdn");
  });
});

test.describe("mobile", () => {
  test.use({ storageState: ADMIN_AUTH_FILE, viewport: { width: 390, height: 844 }, hasTouch: true });

  test("#348: the capture button shows on the dashboard but not over list pages", async ({ page }) => {
    const camera = page.locator('input[type="file"][accept="image/*"][capture]');

    await page.goto("/dashboard");
    await expect(camera).toHaveCount(1);

    await page.goto("/contracts");
    await expect(camera).toHaveCount(0);
    await page.goto("/settings");
    await expect(camera).toHaveCount(0);
  });
});
