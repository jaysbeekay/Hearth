import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE, BASE_URL } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

// #252: the Documents page used to fetch every row from every document
// table with no take/skip at all. This seeds enough contract documents to
// cross the page boundary and checks the paginated feed actually pages,
// rather than silently falling back to "load everything".
const PAGE_SIZE = 20;
const SEED_COUNT = PAGE_SIZE + 2;

function pdfBytes(n: number): Buffer {
  return Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n%${n}`);
}

test("the Contracts document feed paginates instead of loading every row at once", async ({
  page,
  request,
}) => {
  // One /api/sync batch creating SEED_COUNT contracts, each with its own
  // attached document — far faster than SEED_COUNT UI round trips, and
  // exercises the same offline-sync create+saveFile path #249 covers.
  const operations = Array.from({ length: SEED_COUNT }, (_, i) => ({
    id: `e2e-pagination-seed-${Date.now()}-${i}`,
    entity: "contract",
    operation: "create" as const,
    formValues: {
      title: `Pagination Seed Contract ${i}`,
      category: "OTHER",
      provider: "Pagination Test Provider",
      renewalType: "MANUAL_RENEWAL",
    },
  }));

  const multipart: Record<
    string,
    string | { name: string; mimeType: string; buffer: Buffer }
  > = { operations: JSON.stringify(operations) };
  for (const op of operations) {
    multipart[`file:${op.id}:file`] = {
      name: `${op.id}.pdf`,
      mimeType: "application/pdf",
      buffer: pdfBytes(operations.indexOf(op)),
    };
  }

  const syncRes = await request.post(`${BASE_URL}/api/sync`, { multipart });
  expect(syncRes.ok()).toBe(true);
  const results = (await syncRes.json()).results as { success: boolean }[];
  expect(results.every((r) => r.success)).toBe(true);

  await page.goto("/documents?type=Contracts");
  await expect(page.locator("body")).toContainText("Pagination Seed Contract");

  // First page: exactly PAGE_SIZE rows shown, and an "Older" link since more
  // than PAGE_SIZE contract documents now exist.
  const rowsOnPage1 = await page.locator("table tbody tr").count();
  expect(rowsOnPage1).toBe(PAGE_SIZE);
  const olderLink = page.getByRole("link", { name: "Older →" });
  await expect(olderLink).toBeVisible();

  await olderLink.click();
  await expect(page).toHaveURL(/page=1/);
  await expect(page.getByRole("link", { name: "← Newer" })).toBeVisible();
  // Fewer than a full page left, and no further "Older" link.
  const rowsOnPage2 = await page.locator("table tbody tr").count();
  expect(rowsOnPage2).toBeGreaterThan(0);
  expect(rowsOnPage2).toBeLessThan(PAGE_SIZE);
  await expect(page.getByRole("link", { name: "Older →" })).toHaveCount(0);
});
