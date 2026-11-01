import fs from "fs";
import { createClient } from "@libsql/client";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE, DATABASE_URL, FIXTURES_FILE, type Fixtures } from "../env";

// #397 — one Document list for every kind of record. Trip segment, Rental
// statement, Maintenance record, Service record and Trade Documents used
// to have no star, no Document type and no version history; they now get
// the same row as a Contract's.

test.use({ storageState: ADMIN_AUTH_FILE });

function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
}

const docLink = (page: Page, filename: string) => page.locator('a[href^="/api/documents/"]', { hasText: filename });

/**
 * Uploads a PDF with the first "Add document" button inside `scope`, then
 * sets its Document type on its row (#405), and returns its id.
 */
async function upload(page: Page, scope: Locator, filename: string, typeLabel: string): Promise<string> {
  const form = scope.locator('form:has(button[aria-label^="Add document to"])').first();
  await form.locator('input[type="file"][name="file"]').setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: pdfBytes(),
  });
  const link = docLink(page, filename).first();
  await expect(link).toBeVisible({ timeout: 30_000 });
  const id = ((await link.getAttribute("href")) ?? "").split("/").pop() ?? "";
  expect(id).not.toBe("");
  await rowOf(page, filename).getByLabel(`Document type for ${filename}`).selectOption({ label: typeLabel });
  await expectType(page, filename, typeLabel);
  return id;
}

/** The Document type picked on a row, after a reload so it's the saved one. */
async function expectType(page: Page, filename: string, typeLabel: string) {
  await expect
    .poll(async () => {
      await page.reload();
      return rowOf(page, filename)
        .getByLabel(`Document type for ${filename}`)
        .evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.text ?? "");
    })
    .toBe(typeLabel);
}

/** The list row (li) of a Document's latest version. */
function rowOf(page: Page, filename: string): Locator {
  return page.locator("li", { has: docLink(page, filename) }).last();
}

// No UI files a new version under these kinds (the Inbox only does it for
// Contracts, Warranties and Inventory), so test setup writes the same
// columns supersedeDocumentCommand and setDocumentImportantCommand write.
async function sql(statement: string, args: (string | number)[]) {
  const client = createClient({ url: DATABASE_URL });
  try {
    await client.execute({ sql: statement, args });
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
  await expect
    .poll(async () => {
      await page.reload();
      return rowOf(page, filename).getByRole("button", { name: `Unmark ${filename} as important` }).count();
    })
    .toBe(1);
}

async function moveToTrash(page: Page, filename: string) {
  await page.getByRole("button", { name: `Delete ${filename}`, exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("Moved to Recently deleted.");
  await expect(docLink(page, filename)).toHaveCount(0);
}

async function deleteFromOverflowMenu(page: Page, url: string, leavesTo: RegExp) {
  await page.goto(url);
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  // The page's own Delete, not a service record's or maintenance record's.
  const menu = page.getByRole("dialog", { name: "More actions", exact: true }).first();
  await menu.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForURL(leavesTo);
}

test.describe.serial("The one Document list", () => {
  let tripUrl: string;

  test.beforeAll(() => {
    const { tripAId } = JSON.parse(fs.readFileSync(FIXTURES_FILE, "utf8")) as Fixtures;
    tripUrl = `/travel/${tripAId}`;
  });

  test("a Trip segment Document shows its type, can be starred, and groups versions", async ({ page }) => {
    const stamp = Date.now();
    const v1 = `segment-v1-${stamp}.pdf`;
    const v2 = `segment-v2-${stamp}.pdf`;
    const v3 = `segment-v3-${stamp}.pdf`;
    await page.goto(tripUrl);
    const main = page.locator("main");
    const v1Id = await upload(page, main, v1, "Receipt");
    const v2Id = await upload(page, main, v2, "Receipt");
    const v3Id = await upload(page, main, v3, "Receipt");

    await expectType(page, v3, "Receipt");
    await expectStarToggles(page, v3);

    // v1 ← v2 ← v3, and v1 keeps a star from before v2 was filed.
    await sql("UPDATE trip_segment_documents SET supersedesId = ? WHERE id = ?", [v1Id, v2Id]);
    await sql("UPDATE trip_segment_documents SET supersedesId = ? WHERE id = ?", [v2Id, v3Id]);
    await sql("UPDATE trip_segment_documents SET isImportant = 1 WHERE id = ?", [v1Id]);
    await page.reload();
    await expect(rowOf(page, v3)).toContainText("Latest");
    const versions = page.getByRole("list", { name: `Older versions of ${v3}` });
    await expect(versions.locator('a[href^="/api/documents/"]')).toHaveCount(2);
    // Older versions aren't listed again as Documents of their own.
    await expect(docLink(page, v1)).toHaveCount(1);
    await expect(versions.getByRole("button", { name: `Delete ${v1}`, exact: true })).toBeVisible();
    await expect(versions.getByRole("button", { name: `Preview ${v1}` })).toBeVisible();
    await expect(versions.locator("li", { hasText: v1 })).toContainText("Receipt");

    // A starred older version shows its star and can be unstarred there;
    // an unstarred one shows none.
    await expect(versions.getByRole("button", { name: `Mark ${v2} as important` })).toHaveCount(0);
    await versions.getByRole("button", { name: `Unmark ${v1} as important` }).click();
    await expect(versions.getByRole("button", { name: `Mark ${v1} as important` })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // Moving the middle version to Trash doesn't split the Document in two.
    await moveToTrash(page, v2);
    await page.reload();
    await expect(rowOf(page, v3)).toContainText("Latest");
    await expect(page.getByRole("list", { name: `Older versions of ${v3}` }).locator("a", { hasText: v1 })).toHaveCount(
      1,
    );

    // Clean up: the rest of the chain goes to Trash too.
    await moveToTrash(page, v1);
    await moveToTrash(page, v3);
  });

  test("Rental statement, Maintenance record and Service record Documents show the type and star", async ({
    page,
  }) => {
    const stamp = Date.now();

    await page.goto("/home/new");
    await page.locator("#label").fill(`Document List Property ${stamp}`);
    await page.locator("#occupancyStatus").selectOption("RENTED");
    await Promise.all([
      page.waitForURL(/\/home\/(?!new$)[^/]+$/),
      page.getByRole("button", { name: "Add property" }).click(),
    ]);
    const propertyUrl = new URL(page.url()).pathname;

    await page.goto(`${propertyUrl}/items/new`);
    await page.locator("#title").fill(`Document List Repair ${stamp}`);
    await Promise.all([
      page.waitForURL(new RegExp(`${propertyUrl}$`)),
      page.locator('form:has(#title) button[type="submit"]').click(),
    ]);

    // Rental statements show once the Property has a Tenancy.
    await page.goto(`${propertyUrl}/rental/agreements/new`);
    await page.locator("#weeklyRent").fill("500");
    await page.locator("#tenantName").fill("Document List Tenant");
    await page.locator("#leaseStart").fill("2026-01-01");
    await page.locator("#leaseEnd").fill("2027-12-31");
    await Promise.all([
      page.waitForURL(new RegExp(`${propertyUrl}/rental$`)),
      page.locator("main button[type=submit]").last().click(),
    ]);
    await page.goto(`${propertyUrl}/rental/statements/new`);
    await page.locator("#statementDate").fill("2026-06-30");
    await page.locator("#grossRent").fill("2000");
    await Promise.all([
      page.waitForURL(new RegExp(`${propertyUrl}/rental$`)),
      page.locator("main button[type=submit]").last().click(),
    ]);

    await page.goto("/vehicles/new");
    await page.locator("#label").fill(`Document List Vehicle ${stamp}`);
    await Promise.all([
      page.waitForURL(/\/vehicles\/(?!new$)[^/]+$/),
      page.getByRole("button", { name: "Add vehicle" }).click(),
    ]);
    const vehicleUrl = new URL(page.url()).pathname;
    await page.goto(`${vehicleUrl}/items/new`);
    await page.locator("#title").fill(`Document List Service ${stamp}`);
    await Promise.all([
      page.waitForURL(new RegExp(`${vehicleUrl}$`)),
      page.locator('form:has(#title) button[type="submit"]').click(),
    ]);

    const pages = [
      { name: "Rental statement", url: `${propertyUrl}/rental`, type: "Invoice" },
      { name: "Maintenance record", url: propertyUrl, type: "Receipt" },
      { name: "Service record", url: vehicleUrl, type: "Service record" },
    ];
    for (const { name, url, type } of pages) {
      await test.step(name, async () => {
        const filename = `${name.toLowerCase().replace(/ /g, "-")}-${stamp}.pdf`;
        await page.goto(url);
        await upload(page, page.locator("main"), filename, type);
        await expectType(page, filename, type);
        await expectStarToggles(page, filename);
        await moveToTrash(page, filename);
      });
    }

    await deleteFromOverflowMenu(page, vehicleUrl, /\/vehicles$/);
    await deleteFromOverflowMenu(page, propertyUrl, /\/home$/);
  });

  test("a Trade Document gets the same row: type, star, preview, Move to Trash with Undo", async ({ page }) => {
    const stamp = Date.now();
    const portfolioName = `Document List Portfolio ${stamp}`;
    await page.goto("/wealth/portfolios/new");
    await page.locator("#name").fill(portfolioName);
    await Promise.all([
      page.waitForURL(/\/wealth\/portfolios\/(?!new$)[^/]+$/),
      page.getByRole("button", { name: "Add portfolio" }).click(),
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
    await expectType(page, filename, "Invoice");
    await expect(row.getByRole("button", { name: `Preview ${filename}` })).toBeVisible();
    await expectStarToggles(page, filename);

    await rowOf(page, filename).getByRole("button", { name: `Delete ${filename}`, exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Settings → Recently deleted");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    const toast = page.getByRole("status");
    await expect(toast).toContainText("Moved to Recently deleted.");
    await expect(docLink(page, filename)).toHaveCount(0);
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(docLink(page, filename)).toHaveCount(1);

    // Clean up: deleting the portfolio takes its trades and their Documents.
    await page.goto("/wealth/portfolios");
    const card = page.locator("div.rounded-lg.border.border-border.bg-surface", { hasText: portfolioName });
    await card.getByRole("button", { name: `More actions for ${portfolioName}` }).click();
    await card.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: `Delete "${portfolioName}"` }).click();
    await expect(page.locator("body")).not.toContainText(portfolioName);
  });
});
