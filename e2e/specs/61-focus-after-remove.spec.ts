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
  const restore = row.getByRole("button", { name: "Restore" });
  // Restore is a SubmitButton, disabled until the page hydrates (#609);
  // focus() doesn't wait for that the way click() does, and a disabled
  // button can't take focus, so Enter would go nowhere.
  await expect(restore).toBeEnabled();
  await restore.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Restored.");
  await expect(page.getByText(restored, { exact: true })).toHaveCount(0);
  // The entry's name: Enter there does nothing, where Restore would restore it.
  await expect(entries.filter({ has: page.getByText(next, { exact: true }) }).locator("p").first()).toBeFocused();
});

// The Contracts list's swipe-to-delete (phones): its Delete sits before the
// card in the DOM and is only revealed by a swipe, so focus goes to the next
// card's link, never to that card's hidden Delete.
test.describe("Contracts list swipe-delete", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a keyboard delete focuses the next contract's card", async ({ page }) => {
    const stamp = `Swipefocus${Date.now()}`;
    const titles = [`${stamp} A`, `${stamp} B`];
    for (const title of titles) {
      await page.goto("/contracts/new");
      await page.locator("#title").fill(title);
      await page.locator("#category").selectOption("OTHER");
      await page.locator("#provider").fill("Focus Provider");
      await page.locator("main button[type=submit]").click();
      await page.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
    }

    await page.goto(`/contracts?q=${stamp}`);
    const cards = page.locator("main a[href^='/contracts/']", { hasText: stamp });
    await expect(cards).toHaveCount(2);
    const order = (await cards.allInnerTexts()).map((text) => titles.find((t) => text.includes(t))!);
    const [gone, next] = order;

    // Retried: Enter before the page hydrates does nothing (see 07-mobile-responsive).
    await expect(async () => {
      await page.getByRole("button", { name: `Delete ${gone}`, exact: true }).focus();
      await page.keyboard.press("Enter"); // opens the confirm dialog, focus on Cancel
      await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await page.keyboard.press("Tab"); // to its Delete
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("Moved to Recently deleted.");
    await expect(cards).toHaveCount(1);
    // Stays on the list rather than reloading it.
    expect(new URL(page.url()).search).toContain(stamp);

    await expect(cards.filter({ hasText: next })).toBeFocused();
    await expect(page.getByRole("button", { name: `Delete ${next}`, exact: true })).not.toBeFocused();
  });
});

// Review of #650 — a key pressed after the delete resolves but before the
// re-render drops the row (a few ms, longer on a slow phone) must not cancel
// the hand-off. The key is sent the moment the Done toast is raised, which is
// just before ConfirmForm starts the hand-off and before the row goes.
test("a key pressed while the row is leaving doesn't cancel the hand-off", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/travel/new");
  await page.locator("#title").fill(`Focus race trip ${stamp}`);
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(/\/travel\/(?!new$)[^/]+$/);
  const tripUrl = new URL(page.url()).pathname;
  for (const [title, date] of [["Race gone", "2026-04-01"], ["Race next", "2026-04-02"]]) {
    await page.goto(`${tripUrl}/segments/new`);
    await page.locator('select[name="type"]').selectOption("ACTIVITY");
    await page.locator('input[name="title"]').fill(title);
    await page.locator('input[name="startDate"]').fill(date);
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(`**${tripUrl}`);
  }

  await page.evaluate(() => {
    const w = window as unknown as { raceRowPresent?: boolean };
    window.addEventListener(
      "hearth:toast",
      () => {
        setTimeout(() => {
          const menu = document.querySelector('[aria-label="More actions for Race gone"]');
          w.raceRowPresent = !!menu?.isConnected;
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
        }, 0);
      },
      { once: true },
    );
  });

  await page.getByRole("button", { name: "More actions for Race gone", exact: true }).focus();
  await page.keyboard.press("Enter"); // opens the row menu, focus on Delete
  await page.keyboard.press("Enter"); // opens the confirm dialog, focus on Cancel
  await page.keyboard.press("Tab"); // to the dialog's Delete
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: "More actions for Race gone", exact: true })).toHaveCount(0);
  // The key really did land while the row was still there.
  expect(await page.evaluate(() => (window as unknown as { raceRowPresent?: boolean }).raceRowPresent)).toBe(true);
  await expect(page.getByRole("button", { name: "More actions for Race next", exact: true })).toBeFocused();
});
