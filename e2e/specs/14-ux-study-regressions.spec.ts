import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

// Phase 5 of the UX-study delivery plan (#199-#212): permanent regression
// coverage for the net-new features Phases 0-4 shipped, which until now had
// only been verified by throwaway manual smoke tests. Deliberately doesn't
// duplicate what's already covered elsewhere: module enable/disable + nav
// visibility (04-module-gating.spec.ts), long-value wrapping and mobile
// viewport/overflow behaviour (07-mobile-responsive.spec.ts). Also skips a
// UI-driven extraction-confirmation test — reaching extractionPending
// requires a real OCR pass through pdftotext/tesseract, which is too slow
// and environment-dependent for a reliable e2e assertion.
test.use({ storageState: ADMIN_AUTH_FILE });

test("reminder health card reports no delivery channel configured, and the test button surfaces that", async ({
  page,
}) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill("Reminder Health Regression Contract");
  await page.locator("#provider").fill("Regression Provider");
  const end = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  await page.locator("#endDate").fill(end);
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator('form:has(#title) button[type="submit"]').click(),
  ]);

  await expect(page.getByRole("heading", { name: "Reminder health", exact: true })).toBeVisible();
  await expect(page.getByText("Enabled").locator("..").getByText("Yes")).toBeVisible();
  await expect(page.getByText("None configured")).toBeVisible();

  await page.getByRole("button", { name: "Send test reminder" }).click();
  await expect(
    page.getByText("No delivery channel is configured yet — set up email or ntfy in Settings.").first(),
  ).toBeVisible();
});

test("starring a document marks it Important and the star persists after reload", async ({ page }) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill("Important Flag Regression Contract");
  await page.locator("#provider").fill("Regression Provider");
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator('form:has(#title) button[type="submit"]').click(),
  ]);

  await page.locator('input[type="file"]').first().setInputFiles({
    name: "important-flag-test.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nimportant flag regression fixture\n"),
  });
  await page.locator('form:has(input[type="file"]) button[type="submit"]').first().click();
  await page.waitForSelector("text=important-flag-test.pdf");

  const star = page.getByRole("button", { name: "Mark important-flag-test.pdf as important" });
  await star.click();
  await expect(page.getByRole("button", { name: "Unmark important-flag-test.pdf as important" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Unmark important-flag-test.pdf as important" })).toBeVisible();
});

test("the Missing document filter chip on the Contracts list filters correctly", async ({ page }) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill("Filter Regression - Has Document");
  await page.locator("#provider").fill("Regression Provider");
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator('form:has(#title) button[type="submit"]').click(),
  ]);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "has-doc.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nhas document fixture\n"),
  });
  await page.locator('form:has(input[type="file"]) button[type="submit"]').first().click();
  await page.waitForSelector("text=has-doc.pdf");

  await page.goto("/contracts/new");
  await page.locator("#title").fill("Filter Regression - Missing Document");
  await page.locator("#provider").fill("Regression Provider");
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator('form:has(#title) button[type="submit"]').click(),
  ]);

  await page.goto("/contracts");
  await page.getByRole("button", { name: "Missing document" }).click();
  await page.waitForURL(/missingDocument=true/);

  await expect(page.getByText("Filter Regression - Missing Document")).toBeVisible();
  await expect(page.getByText("Filter Regression - Has Document")).toHaveCount(0);
});

test("global search Important filter finds a starred contract's document", async ({ page }) => {
  // Timestamped title (#315): a slow first attempt that times out on the
  // final assertion *after* the contract was already created causes
  // Playwright's automatic retry to re-run this test from scratch — a fixed
  // title would then create a second, identically-named contract, which
  // fails the retry deterministically on a strict-mode "2 elements"
  // violation instead of letting it recover.
  const title = `Search Important Regression Contract ${Date.now()}`;
  await page.goto("/contracts/new");
  await page.locator("#title").fill(title);
  await page.locator("#provider").fill("Regression Provider");
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator('form:has(#title) button[type="submit"]').click(),
  ]);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "search-important-test.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nsearch important regression fixture\n"),
  });
  await page.locator('form:has(input[type="file"]) button[type="submit"]').first().click();
  await page.waitForSelector("text=search-important-test.pdf");
  await page.getByRole("button", { name: "Mark search-important-test.pdf as important" }).click();
  await expect(
    page.getByRole("button", { name: "Unmark search-important-test.pdf as important" }),
  ).toBeVisible();

  await page.goto("/dashboard");
  await page.locator("aside").getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Important" }).click();
  await expect(page.getByText(title)).toBeVisible({ timeout: 10000 });
});

test("copying an identifier from a detail page shows a confirmation state", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/contracts/new");
  await page.locator("#title").fill("Copy Button Regression Contract");
  await page.locator("#provider").fill("Regression Provider");
  await page.locator("#contractNumber").fill("REGRESSION-POLICY-99887766");
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator('form:has(#title) button[type="submit"]').click(),
  ]);

  const copyButton = page.getByRole("button", { name: "Copy Contract / policy number" });
  await expect(copyButton).toBeVisible();
  await copyButton.click();
  await expect(page.getByRole("button", { name: "Copied Contract / policy number" })).toBeVisible();
});

test("uploading a file identical to an already-filed document is flagged as a possible duplicate in the inbox", async ({
  page,
}) => {
  const duplicateContent = Buffer.from("%PDF-1.4\nduplicate detection regression fixture unique 42\n");

  await page.goto("/contracts/new");
  await page.locator("#title").fill("Duplicate Source Contract");
  await page.locator("#provider").fill("Regression Provider");
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator('form:has(#title) button[type="submit"]').click(),
  ]);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "original.pdf",
    mimeType: "application/pdf",
    buffer: duplicateContent,
  });
  await page.locator('form:has(input[type="file"]) button[type="submit"]').first().click();
  await page.waitForSelector("text=original.pdf");

  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "duplicate-copy.pdf",
    mimeType: "application/pdf",
    buffer: duplicateContent,
  });
  await page.waitForSelector("text=duplicate-copy.pdf");
  const row = page.locator("div", { has: page.getByText("duplicate-copy.pdf") }).first();
  await row.locator("select").selectOption("INBOX");
  // exact: true avoids matching the queue's own upload dropzone, whose
  // accessible name ("...Visible to your whole household once saved.", #285)
  // contains "saved" and would otherwise satisfy a substring match too.
  await row.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved duplicate-copy.pdf")).toBeVisible();

  await page.goto("/documents/inbox");
  await expect(page.getByText("This file looks identical to something already saved.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Attach as new version" })).toBeVisible();

  await page.getByRole("button", { name: "Keep as separate document" }).click();
  await expect(page.getByText("This file looks identical to something already saved.")).toHaveCount(0);
});
