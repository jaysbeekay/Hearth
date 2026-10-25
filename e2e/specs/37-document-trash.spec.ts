import fs from "fs";
import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE, FIXTURES_FILE, type Fixtures } from "../env";

// #396 — every Document kind goes to Trash with Undo, through one Document
// command and one file route. Trip-segment Documents used to be deleted
// for good ("This can't be undone"); this covers them end to end.

test.use({ storageState: ADMIN_AUTH_FILE });

let tripUrl: string;

test.beforeAll(() => {
  const { tripAId } = JSON.parse(fs.readFileSync(FIXTURES_FILE, "utf8")) as Fixtures;
  tripUrl = `/travel/${tripAId}`;
});

function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
}

async function uploadToSegment(page: Page, filename: string): Promise<string> {
  await page.goto(tripUrl);
  await page.locator('input[type="file"][name="file"]').first().setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: pdfBytes(),
  });
  const submit = page.locator('form:has(input[name="file"]) button[type="submit"]').first();
  await submit.click();
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  const link = page.locator('a[href^="/api/documents/"]', { hasText: filename }).first();
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href")) ?? "";
  const id = href.split("/").pop() ?? "";
  expect(id).not.toBe("");
  return id;
}

async function deleteFromList(page: Page, filename: string) {
  await page.getByRole("button", { name: `Delete ${filename}` }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Move");
  await expect(dialog).toContainText("Settings → Trash");
  await expect(dialog).not.toContainText("can't be undone");
  await dialog.getByRole("button", { name: "Delete document" }).click();
}

test.describe.serial("Trip segment Documents go to Trash", () => {
  test("deleting one offers Undo, which brings it back", async ({ page }) => {
    const filename = `segment-undo-${Date.now()}.pdf`;
    await uploadToSegment(page, filename);

    await deleteFromList(page, filename);
    const toast = page.getByRole("status");
    await expect(toast).toContainText("Document moved to Trash.");
    await expect(page.locator('a[href^="/api/documents/"]', { hasText: filename })).toHaveCount(0);

    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator('a[href^="/api/documents/"]', { hasText: filename })).toHaveCount(1);
  });

  test("a deleted one is listed in Trash, 404s while there, and can be restored", async ({ page, context }) => {
    const filename = `segment-trash-${Date.now()}.pdf`;
    const id = await uploadToSegment(page, filename);

    // The one file route serves it, and the old per-module URL redirects there.
    const direct = await context.request.get(`/api/documents/${id}`);
    expect(direct.status()).toBe(200);
    expect(direct.headers()["content-disposition"]).toContain("attachment");
    const legacy = await context.request.get(`/api/travel/documents/${id}`, { maxRedirects: 0 });
    expect(legacy.status()).toBe(308);
    expect(legacy.headers()["location"]).toBe(`/api/documents/${id}`);
    const followed = await context.request.get(`/api/travel/documents/${id}`);
    expect(followed.status()).toBe(200);
    expect(followed.headers()["content-disposition"]).toContain(filename);

    await deleteFromList(page, filename);
    await expect(page.getByRole("status")).toContainText("Document moved to Trash.");
    expect((await context.request.get(`/api/documents/${id}`)).status()).toBe(404);

    await page.goto("/settings/trash");
    const row = page.locator("li", { hasText: filename });
    await expect(row).toContainText("Trip segment document");
    await row.getByRole("button", { name: "Restore" }).click();
    await expect(page.locator("li", { hasText: filename })).toHaveCount(0);

    await page.goto(tripUrl);
    await expect(page.locator('a[href^="/api/documents/"]', { hasText: filename })).toHaveCount(1);
    expect((await context.request.get(`/api/documents/${id}`)).status()).toBe(200);
  });

  test("an offline delete is queued and syncs to Trash on reconnect", async ({ page, context }) => {
    const filename = `segment-offline-${Date.now()}.pdf`;
    const id = await uploadToSegment(page, filename);

    await context.setOffline(true);
    try {
      await deleteFromList(page, filename);
      await expect(page.getByRole("status").first()).toContainText("Delete queued");
    } finally {
      await context.setOffline(false);
    }
    await expect(page.getByText(/1 change synced successfully/).first()).toBeVisible({ timeout: 20_000 });
    expect((await context.request.get(`/api/documents/${id}`)).status()).toBe(404);

    await page.goto("/settings/trash");
    await expect(page.locator("li", { hasText: filename })).toContainText("Trip segment document");
  });

  test("an offline delete queued before the upgrade (old entity name) still syncs", async ({ page, context }) => {
    const filename = `segment-legacy-op-${Date.now()}.pdf`;
    const id = await uploadToSegment(page, filename);
    const segmentLink = page.locator('a[href^="/api/documents/"]', { hasText: filename }).first();
    await expect(segmentLink).toBeVisible();

    const operations = [{ id: `legacy-${Date.now()}`, entity: "tripSegmentDocument", operation: "delete", entityId: id }];
    const res = await context.request.post("/api/sync", { multipart: { operations: JSON.stringify(operations) } });
    expect(res.ok()).toBe(true);
    const { results } = (await res.json()) as { results: { success: boolean; error?: string }[] };
    expect(results).toEqual([{ id: operations[0].id, success: true }]);
    expect((await context.request.get(`/api/documents/${id}`)).status()).toBe(404);
  });

  test("a disabled module's Document 404s from the file route", async ({ page, context }) => {
    const filename = `segment-gated-${Date.now()}.pdf`;
    const id = await uploadToSegment(page, filename);

    await page.goto("/settings/modules");
    await page.locator("li", { hasText: "Travel" }).getByRole("button", { name: "Disable" }).click();
    await expect(page.locator("body")).toContainText("Module disabled.");
    try {
      expect((await context.request.get(`/api/documents/${id}`)).status()).toBe(404);
    } finally {
      await page.goto("/settings/modules");
      await page.locator("li", { hasText: "Travel" }).getByRole("button", { name: "Enable" }).click();
      await expect(page.locator("body")).toContainText("Module enabled.");
    }
    expect((await context.request.get(`/api/documents/${id}`)).status()).toBe(200);
  });
});
