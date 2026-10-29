import fs from "fs";
import { createClient } from "@libsql/client";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE, DATABASE_URL, FIXTURES_FILE, type Fixtures } from "../env";

// #397 — one Document list for every kind of record. Trip segment and Trade
// Documents used to have no star, no Document type and no version history;
// they now get the same row as a Contract's.

test.use({ storageState: ADMIN_AUTH_FILE });

function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
}

/** Uploads a PDF through the first upload form inside `scope`, with a Document type, and returns its id. */
async function upload(page: Page, scope: Locator, filename: string, typeLabel: string): Promise<string> {
  const form = scope.locator('form:has(input[name="file"])').first();
  await form.getByLabel("Document type").selectOption({ label: typeLabel });
  await form.locator('input[type="file"][name="file"]').setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: pdfBytes(),
  });
  await form.getByRole("button", { name: "Upload" }).click();
  await expect(form).toContainText("Document uploaded.", { timeout: 30_000 });
  const link = page.locator('a[href^="/api/documents/"]', { hasText: filename }).first();
  await expect(link).toBeVisible();
  const id = ((await link.getAttribute("href")) ?? "").split("/").pop() ?? "";
  expect(id).not.toBe("");
  return id;
}

/** The list row (li) of a Document's latest version. */
function rowOf(page: Page, filename: string): Locator {
  return page.locator("li", { has: page.locator('a[href^="/api/documents/"]', { hasText: filename }) }).last();
}

// No UI files a new version under these kinds (the Inbox only does it for
// Contracts, Warranties and Inventory), so the link is written directly,
// the same column supersedeDocumentCommand writes.
async function linkVersions(table: string, newerId: string, olderId: string) {
  const client = createClient({ url: DATABASE_URL });
  try {
    await client.execute({ sql: `UPDATE ${table} SET supersedesId = ? WHERE id = ?`, args: [olderId, newerId] });
  } finally {
    client.close();
  }
}

async function expectStarToggles(page: Page, filename: string) {
  await rowOf(page, filename).getByRole("button", { name: `Mark ${filename} as important` }).click();
  await expect(rowOf(page, filename).getByRole("button", { name: `Unmark ${filename} as important` })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Saved, not just optimistic.
  await expect.poll(async () => {
    await page.reload();
    return rowOf(page, filename).getByRole("button", { name: `Unmark ${filename} as important` }).count();
  }).toBe(1);
}

test.describe.serial("The one Document list", () => {
  let tripUrl: string;

  test.beforeAll(() => {
    const { tripAId } = JSON.parse(fs.readFileSync(FIXTURES_FILE, "utf8")) as Fixtures;
    tripUrl = `/travel/${tripAId}`;
  });

  test("a Trip segment Document shows its type, can be starred, and groups versions", async ({ page }) => {
    const stamp = Date.now();
    const older = `segment-v1-${stamp}.pdf`;
    const newer = `segment-v2-${stamp}.pdf`;
    await page.goto(tripUrl);
    const segment = page.locator("main");
    const olderId = await upload(page, segment, older, "Receipt");
    const newerId = await upload(page, segment, newer, "Receipt");

    await expect(rowOf(page, newer)).toContainText("Receipt");
    await expectStarToggles(page, newer);

    await linkVersions("trip_segment_documents", newerId, olderId);
    await page.reload();
    const row = rowOf(page, newer);
    await expect(row).toContainText("Latest");
    const versions = page.getByRole("list", { name: `Older versions of ${newer}` });
    await expect(versions.locator('a[href^="/api/documents/"]', { hasText: older })).toHaveCount(1);
    // The older version isn't listed again as a Document of its own.
    await expect(page.locator('a[href^="/api/documents/"]', { hasText: older })).toHaveCount(1);
    await expect(versions.getByRole("button", { name: `Move ${older} to Trash` })).toBeVisible();
  });

  test("a Trade Document gets the same row: type, star, preview, Move to Trash with Undo", async ({ page }) => {
    const stamp = Date.now();
    await page.goto("/wealth/portfolios/new");
    await page.locator("#name").fill(`Document List Portfolio ${stamp}`);
    await Promise.all([
      page.waitForURL(/\/wealth\/portfolios\/(?!new$)[^/]+$/),
      page.getByRole("button", { name: "Create portfolio" }).click(),
    ]);
    const portfolioId = page.url().split("/portfolios/")[1];

    await page.goto(`/wealth/portfolios/${portfolioId}/holdings/new`);
    await page.locator("#ticker").fill("DLST");
    await Promise.all([
      page.waitForURL(/\/holdings\/(?!new$)[^/]+$/),
      page.getByRole("button", { name: "Add holding" }).click(),
    ]);
    const holdingUrl = new URL(page.url()).pathname;

    await page.goto(`${holdingUrl}/trades/new`);
    await page.locator("#date").fill("2026-01-01");
    await page.locator("#units").fill("1");
    await page.locator("#pricePerUnit").fill("1");
    await Promise.all([
      page.waitForURL(/\/holdings\/[^/]+$/),
      page.getByRole("button", { name: "Add trade" }).click(),
    ]);

    await page.goto(holdingUrl);
    const filename = `trade-note-${stamp}.pdf`;
    await upload(page, page.locator("main"), filename, "Invoice");

    const row = rowOf(page, filename);
    await expect(row).toContainText("Invoice");
    await expect(row.getByRole("button", { name: `Preview ${filename}` })).toBeVisible();
    await expectStarToggles(page, filename);

    await rowOf(page, filename).getByRole("button", { name: `Move ${filename} to Trash` }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Settings → Trash");
    await dialog.getByRole("button", { name: "Move to Trash" }).click();
    const toast = page.getByRole("status");
    await expect(toast).toContainText("Moved to Trash.");
    await expect(page.locator('a[href^="/api/documents/"]', { hasText: filename })).toHaveCount(0);
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator('a[href^="/api/documents/"]', { hasText: filename })).toHaveCount(1);
  });
});
