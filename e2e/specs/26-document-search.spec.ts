import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

// #314: /api/search used to run a plain `contains` (substring) scan per
// document table, missing RentalStatementDocument/TradeDocument entirely.
// It's now backed by a single FTS5 index kept in sync by SQL triggers —
// this covers the trigram tokenizer's substring-matching behavior (the
// acceptance bar was "preserve existing contains semantics, don't regress
// to word-only matching"), the two newly-covered kinds, and the
// soft/hard-delete removal paths. Extraction-dependent behavior
// (extractedText matches, matchedInDocument) isn't covered here — like
// 14-ux-study-regressions.spec.ts, this suite deliberately skips anything
// requiring a real OCR pass (too slow/environment-dependent); the trigger
// sync itself was verified directly against the migrated scratch DB while
// building this feature, and the ranking/resolution logic has unit coverage
// in tests/unit/document-search.test.ts.
test.use({ storageState: ADMIN_AUTH_FILE });

async function openGlobalSearch(page: import("@playwright/test").Page, query: string) {
  await page.goto("/dashboard");
  const searchButton = page.locator("aside").getByRole("button", { name: "Search" });
  // The Search button opens GlobalSearch's dialog via a client-only event
  // listener that isn't wired up until React hydrates. Right after goto(),
  // the button is already painted (SSR) but a click can land before that
  // listener exists and silently no-op — the same class of race documented
  // in 07-mobile-responsive.spec.ts for the nav drawer's edge-swipe
  // listener. Retrying the click until the dialog actually opens beats
  // guessing how long hydration takes.
  await expect(async () => {
    await searchButton.click();
    await expect(page.getByRole("combobox")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("combobox").fill(query);
}

test("filename substring search finds documents across contract, rental statement, and trade kinds", async ({
  page,
}) => {
  const stamp = Date.now();
  const contractFragment = `qzy${stamp}mid`;
  const rentalFragment = `wxv${stamp}mid`;
  const tradeFragment = `abk${stamp}mid`;

  // Contract document — existing coverage, exercises the trigram
  // tokenizer's mid-word substring matching (not a whole-token match).
  await page.goto("/contracts/new");
  await page.locator("#title").fill(`Search FTS Regression Contract ${stamp}`);
  await page.locator("#provider").fill("Regression Provider");
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator('form:has(#title) button[type="submit"]').click(),
  ]);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: `photo_${contractFragment}_scan.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\ncontract fts regression fixture\n"),
  });
  await page.locator('form:has(input[type="file"]) button[type="submit"]').first().click();
  await page.waitForSelector(`text=photo_${contractFragment}_scan.pdf`);

  // Rental statement document — #314's new coverage (zero before this
  // change). Property must be RENTED for rental tracking to apply.
  await page.goto("/home/new");
  await page.locator("#label").fill(`FTS Regression Property ${stamp}`);
  await page.locator("#occupancyStatus").selectOption("RENTED");
  await Promise.all([
    page.waitForURL(/\/home\/(?!new$)[^/]+$/),
    page.getByRole("button", { name: "Add property" }).click(),
  ]);
  const propertyId = page.url().split("/home/")[1];

  await page.goto(`/home/${propertyId}/rental/statements/new`);
  await page.locator('input[type="file"]').setInputFiles({
    name: `statement_${rentalFragment}_march.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nrental statement fts regression fixture\n"),
  });
  await Promise.all([
    page.waitForURL(new RegExp(`/home/${propertyId}/rental$`)),
    page.getByRole("button", { name: "Add statement" }).click(),
  ]);

  // Trade document — #314's other new coverage.
  await page.goto("/wealth/portfolios/new");
  await page.locator("#name").fill(`FTS Regression Portfolio ${stamp}`);
  await Promise.all([
    page.waitForURL(/\/wealth\/portfolios\/(?!new$)[^/]+$/),
    page.getByRole("button", { name: "Create portfolio" }).click(),
  ]);
  const portfolioId = page.url().split("/portfolios/")[1];

  await page.goto(`/wealth/portfolios/${portfolioId}/holdings/new`);
  await page.locator("#ticker").fill("FTSX");
  await Promise.all([
    page.waitForURL(/\/holdings\/(?!new$)[^/]+$/),
    page.getByRole("button", { name: "Add holding" }).click(),
  ]);
  const holdingId = page.url().split("/holdings/")[1];

  await page.goto(`/wealth/portfolios/${portfolioId}/holdings/${holdingId}/trades/new`);
  await page.locator("#date").fill("2026-01-01");
  await page.locator("#units").fill("1");
  await page.locator("#pricePerUnit").fill("1");
  await Promise.all([
    page.waitForURL(/\/holdings\/[^/]+$/),
    page.getByRole("button", { name: "Add trade" }).click(),
  ]);

  await page.goto(`/wealth/portfolios/${portfolioId}/holdings/${holdingId}`);
  const tradeRow = page.locator("div.rounded-xl.border.border-border.bg-surface.p-4", { hasText: "Buy" });
  await tradeRow.locator('input[type="file"]').setInputFiles({
    name: `confirmation_${tradeFragment}_note.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\ntrade fts regression fixture\n"),
  });
  await tradeRow.getByRole("button", { name: "Upload" }).click();
  // A bare filename match would also hit FileDropZone's own client-side
  // selected-file preview, which appears on setInputFiles() regardless of
  // whether the upload actually succeeded.
  await expect(tradeRow).toContainText("Document uploaded.");

  // Each fragment is a mid-word substring of its filename (never a leading
  // token) — a whole-token tokenizer would miss all three.
  await openGlobalSearch(page, contractFragment);
  await expect(page.getByText(`photo_${contractFragment}_scan.pdf`)).toBeVisible();

  await page.getByRole("combobox").fill(rentalFragment);
  await expect(page.getByText(`statement_${rentalFragment}_march.pdf`)).toBeVisible();

  await page.getByRole("combobox").fill(tradeFragment);
  await expect(page.getByText(`confirmation_${tradeFragment}_note.pdf`)).toBeVisible();
});

test("trashing a contract removes its document from search, and permanently deleting keeps it gone", async ({
  page,
}) => {
  const stamp = Date.now();
  const filename = `lifecycle_${stamp}_doc.pdf`;

  await page.goto("/contracts/new");
  await page.locator("#title").fill(`Search Lifecycle Regression Contract ${stamp}`);
  await page.locator("#provider").fill("Regression Provider");
  await Promise.all([
    page.waitForURL(/\/contracts\/(?!new$)[^/]+$/),
    page.locator('form:has(#title) button[type="submit"]').click(),
  ]);
  const contractId = page.url().split("/contracts/")[1];
  await page.locator('input[type="file"]').first().setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nlifecycle regression fixture\n"),
  });
  await page.locator('form:has(input[type="file"]) button[type="submit"]').first().click();
  await page.waitForSelector(`text=${filename}`);

  await openGlobalSearch(page, filename);
  await expect(page.getByText(filename)).toBeVisible();

  // Soft-delete (Trash) — the document row still exists, but the contract's
  // deletedAt filter must exclude it from search.
  await page.goto(`/contracts/${contractId}`);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete contract", exact: true }).click();
  await page.waitForURL(/\/contracts$/);

  // Asserting absence via getByText(filename) would false-positive: the
  // empty-state message itself reads `No results for "<query>".`, which
  // contains the filename as a substring. Assert that message directly
  // instead — a positive, unambiguous check of the empty-result state.
  await openGlobalSearch(page, filename);
  await expect(page.getByText(`No results for "${filename}".`)).toBeVisible();

  // Permanently delete from Trash — hard-deletes the contract, cascading
  // away its document row (and, via the fts_documents_ad trigger, the
  // matching document_search_fts row).
  await page.goto("/settings/trash");
  const row = page.locator("li", { hasText: `Search Lifecycle Regression Contract ${stamp}` });
  await row.getByRole("button", { name: "Delete permanently" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete permanently" }).click();
  await expect(row).toHaveCount(0);

  await openGlobalSearch(page, filename);
  await expect(page.getByText(`No results for "${filename}".`)).toBeVisible();
});
