import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

// #366 — Search opens on Recently viewed and Needs attention instead of an
// empty pane, with three plain chips; the Documents page says "Belongs to"
// for the area and keeps "Document type" for the category.

async function openSearch(page: Page) {
  // The Search button's listener only exists after hydration; retry the
  // click until the dialog opens (see 26-document-search.spec.ts).
  await expect(async () => {
    await page.locator("aside").getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("combobox")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  return page.getByRole("dialog", { name: "Search" });
}

function isoInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

test("Search opens on Recently viewed and Needs attention", async ({ page }) => {
  const title = `Suggestions Contract ${Date.now()}`;
  await page.goto("/contracts/new");
  await page.locator("#title").fill(title);
  await page.locator("#category").selectOption("OTHER");
  await page.locator("#provider").fill("Suggestions Provider");
  await page.locator("#endDate").fill(isoInDays(-2));
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator("main button[type=submit]").click(),
  ]);
  const contractUrl = page.url();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  await page.goto("/dashboard");
  const dialog = await openSearch(page);

  const recent = dialog.getByRole("group", { name: "Recently viewed" });
  await expect(recent.getByRole("option").first()).toContainText(title);
  await expect(recent.getByRole("option").first()).toContainText("Contract");

  const attention = dialog.getByRole("group", { name: "Needs attention" });
  await expect(attention.getByRole("option").first()).toBeVisible();
  expect(await attention.getByRole("option").count()).toBeLessThanOrEqual(3);

  // Three plain chips; the completeness filters live on the lists.
  for (const chip of ["Due soon", "Needs review", "Important"]) {
    await expect(dialog.getByRole("button", { name: chip })).toBeVisible();
  }
  await expect(dialog.getByRole("button", { name: "No document attached" })).toHaveCount(0);

  // Suggestions are options like results: arrow down and Enter opens one.
  await page.getByRole("combobox").press("ArrowDown");
  await page.getByRole("combobox").press("Enter");
  await page.waitForURL(contractUrl);

  // Typing replaces the suggestions with results.
  await page.goto("/dashboard");
  const again = await openSearch(page);
  await page.getByRole("combobox").fill(title);
  await expect(again.getByRole("group", { name: "Contracts" })).toContainText(title);
  await expect(again.getByRole("group", { name: "Recently viewed" })).toHaveCount(0);
});

// #520 review — a partial query hides the suggestions, typing clears a
// highlighted row, and Cmd/Ctrl-K while open brings the suggestions back.
test("Search suggestions follow the box and reopen on Ctrl-K", async ({ page }) => {
  // Own setup so the test runs alone: an overdue contract, viewed once, gives
  // both Recently viewed and Needs attention something to show.
  await page.goto("/contracts/new");
  await page.locator("#title").fill(`Ctrl-K Contract ${Date.now()}`);
  await page.locator("#category").selectOption("OTHER");
  await page.locator("#provider").fill("Suggestions Provider");
  await page.locator("#endDate").fill(isoInDays(-2));
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator("main button[type=submit]").click(),
  ]);

  await page.goto("/dashboard");
  const dialog = await openSearch(page);
  const box = page.getByRole("combobox");
  const recent = dialog.getByRole("group", { name: "Recently viewed" });
  const attention = dialog.getByRole("group", { name: "Needs attention" });
  const anySuggestions = recent.or(attention).first();
  await expect(anySuggestions).toBeVisible();

  await box.press("ArrowDown");
  await expect(box).toHaveAttribute("aria-activedescendant", "global-search-option-0");
  await box.fill("x");
  await expect(box).not.toHaveAttribute("aria-activedescendant", /.+/);
  await expect(recent).toHaveCount(0);
  await expect(attention).toHaveCount(0);
  await expect(dialog.getByText("Type at least 2 characters")).toBeVisible();

  await box.press("ControlOrMeta+k");
  await expect(box).toHaveValue("");
  await expect(anySuggestions).toBeVisible();
});

test("Documents separates Belongs to from Document type", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/contracts/new");
  await page.locator("#title").fill(`Belongs To Contract ${stamp}`);
  await page.locator("#category").selectOption("OTHER");
  await page.locator("#provider").fill("Suggestions Provider");
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator("main button[type=submit]").click(),
  ]);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: `belongs_${stamp}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nbelongs to fixture\n"),
  });
  await page.locator('form:has(input[type="file"]) button[type="submit"]').first().click();
  await page.waitForSelector(`text=belongs_${stamp}.pdf`);

  await page.goto("/documents");
  const belongsTo = page.getByRole("group", { name: "Belongs to" });
  await expect(belongsTo.getByRole("link", { name: /^All \(\d+\)$/ })).toBeVisible();
  await expect(belongsTo.getByRole("link", { name: /^Contracts \(\d+\)$/ })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Filter by document type" })).toBeVisible();

  const table = page.locator("table");
  await expect(table.getByRole("columnheader", { name: "Document type" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Belongs to" })).toBeVisible();
  const row = table.getByRole("row", { name: new RegExp(`belongs_${stamp}`) });
  await expect(row.getByRole("cell").nth(1)).toHaveText("Other");
  await expect(row.getByRole("cell").nth(2)).toContainText("Contracts");
  await expect(row.getByRole("cell").nth(2)).toContainText(`Belongs To Contract ${stamp}`);
});
