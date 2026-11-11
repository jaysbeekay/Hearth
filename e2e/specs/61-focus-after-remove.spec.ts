import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

// #646 — when an action takes the focused control's row off the page, focus
// is handed on (a neighbouring row, or the list's heading or Add control)
// instead of dropping to <body>. The trip-segment cases are in
// 42-entry-trash.spec.ts; these cover the other kinds of list.

test.use({ storageState: ADMIN_AUTH_FILE });

function pdfBytes(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
}

// Presses a confirm-dialog trigger with the keyboard and confirms.
async function confirmByKeyboard(page: Page, triggerName: string, confirmName: string) {
  await page.getByRole("button", { name: triggerName, exact: true }).focus();
  await page.keyboard.press("Enter"); // opens the confirm dialog, focus on Cancel
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: confirmName, exact: true }).focus();
  await page.keyboard.press("Enter");
}

test("deleting a contract's only Document focuses the Documents heading", async ({ page }) => {
  await page.goto("/contracts/new");
  await page.locator("#title").fill(`Focus doc contract ${Date.now()}`);
  await page.locator("#category").selectOption("OTHER");
  await page.locator("#provider").fill("Focus Provider");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);

  const filename = `focus-only-${Date.now()}.pdf`;
  await page.locator('input[type="file"]').first().setInputFiles({ name: filename, mimeType: "application/pdf", buffer: pdfBytes() });
  const submit = page.locator('form:has(input[type="file"]) button[type="submit"]').first();
  await submit.click();
  await expect(page.getByRole("button", { name: `Delete ${filename}`, exact: true })).toBeVisible({ timeout: 30_000 });

  await confirmByKeyboard(page, `Delete ${filename}`, "Delete");
  await expect(page.getByRole("status")).toContainText("Moved to Recently deleted.");
  await expect(page.getByText("No documents uploaded yet.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeFocused();
});

test("removing a webhook keeps focus in the Endpoints list", async ({ page }) => {
  const name = `Focus hook ${Date.now()}`;
  await page.goto("/settings/webhooks");
  await page.locator("#name").fill(name);
  await page.locator("#url").fill("http://127.0.0.1:9/hook");
  await page.getByRole("button", { name: "Add webhook" }).click();
  await expect(page.locator("body")).toContainText(`${name} was added.`);

  await confirmByKeyboard(page, `Remove webhook ${name}`, "Remove webhook");
  await expect(page.getByRole("button", { name: `Remove webhook ${name}`, exact: true })).toHaveCount(0);
  // The innermost section: the Endpoints card, not the Webhooks section around it.
  const endpoints = page.locator("section", { has: page.getByRole("heading", { name: "Endpoints", exact: true }) }).last();
  await expect.poll(() => endpoints.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await expect(page.locator("body")).not.toBeFocused();
});

test("restoring from Recently deleted focuses the next entry's name, not its Restore", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/travel/new");
  await page.locator("#title").fill(`Focus trash trip ${stamp}`);
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/travel\/(?!new$)[^/]+$/);
  const tripUrl = new URL(page.url()).pathname;

  const titles = [`Focus restore A ${stamp}`, `Focus restore B ${stamp}`];
  for (const title of titles) {
    await page.goto(`${tripUrl}/segments/new`);
    await page.locator('select[name="type"]').selectOption("ACTIVITY");
    await page.locator('input[name="title"]').fill(title);
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(`**${tripUrl}`);
  }
  for (const title of titles) {
    await page.getByRole("button", { name: `More actions for ${title}`, exact: true }).click();
    await page.getByRole("dialog", { name: `More actions for ${title}` }).getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("button", { name: `More actions for ${title}`, exact: true })).toHaveCount(0);
  }

  await page.goto("/settings/trash");
  const entries = page.locator("main ul > li");
  const labels = await entries.evaluateAll((lis) => lis.map((li) => li.querySelector("p")?.textContent ?? ""));
  const first = labels.findIndex((l) => titles.includes(l.trim()));
  expect(first).toBeGreaterThanOrEqual(0);
  const restored = labels[first].trim();
  const next = (labels[first + 1] ?? labels[first - 1]).trim();

  const row = entries.filter({ has: page.getByText(restored, { exact: true }) });
  await row.getByRole("button", { name: "Restore" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Restored.");
  await expect(page.getByText(restored, { exact: true })).toHaveCount(0);
  // The entry's name: Enter there does nothing, where Restore would restore it.
  await expect(entries.filter({ has: page.getByText(next, { exact: true }) }).locator("p").first()).toBeFocused();
});
