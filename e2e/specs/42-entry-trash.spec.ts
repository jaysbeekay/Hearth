import fs from "fs";
import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE, FIXTURES_FILE, type Fixtures } from "../env";

// #427 — Trip segments (like Rental statements, Trades, Tenancies and
// Property valuations) go to Trash instead of being deleted outright:
// "Moved to Trash · Undo", listed in Settings → Trash, restorable from
// there, and deleted for good only from there.

test.use({ storageState: ADMIN_AUTH_FILE });

let tripUrl: string;

test.beforeAll(() => {
  const { tripAId } = JSON.parse(fs.readFileSync(FIXTURES_FILE, "utf8")) as Fixtures;
  tripUrl = `/travel/${tripAId}`;
});

async function addSegment(page: Page, title: string) {
  await page.goto(`${tripUrl}/segments/new`);
  await page.locator('select[name="type"]').selectOption("LODGING");
  await page.locator('input[name="title"]').fill(title);
  await page.locator("main button[type=submit]").click();
  await page.waitForURL(`**${tripUrl}`);
  await expect(page.locator("body")).toContainText(title);
}

async function deleteSegment(page: Page, title: string) {
  const row = page.locator("div.rounded-lg.border.border-border.bg-surface", { hasText: title });
  await row.getByRole("button", { name: `More actions for ${title}` }).click();
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Household settings → Recently deleted");
  await expect(dialog).not.toContainText("can't be undone");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
}

test.describe.serial("Trades go to Trash", () => {
  test("deleting one leaves the holding's units until Undo brings it back", async ({ page }) => {
    await page.goto("/settings/modules");
    const wealthRow = page.locator("li", { hasText: "Wealth" });
    if (await wealthRow.getByRole("button", { name: "Enable" }).count()) {
      await wealthRow.getByRole("button", { name: "Enable" }).click();
      await expect(page.locator("body")).toContainText("Module enabled.");
    }

    await page.goto("/wealth/portfolios/new");
    await page.locator("#name").fill(`Trash portfolio ${Date.now()}`);
    await page.getByRole("button", { name: "Add portfolio" }).click();
    await page.waitForURL(/\/wealth\/portfolios\/(?!new$)[^/]+$/);
    await page.getByRole("link", { name: "Add holding" }).click();
    await page.waitForURL(/\/holdings\/new$/);
    await page.locator("#ticker").fill("TRSH");
    await page.getByRole("button", { name: "Add holding" }).click();
    await page.waitForURL(/\/holdings\/(?!new$)[^/]+$/);
    const holdingUrl = new URL(page.url()).pathname;

    await page.getByRole("link", { name: "Add trade" }).click();
    await page.waitForURL(/\/trades\/new$/);
    await page.locator("#type").selectOption("BUY");
    await page.locator("#date").fill("2026-01-01");
    await page.locator("#units").fill("7");
    await page.locator("#pricePerUnit").fill("10");
    await page.getByRole("button", { name: "Add trade" }).click();
    await page.waitForURL(`**${holdingUrl}`);
    const trades = page.getByTitle("Edit trade");
    await expect(trades).toHaveCount(1);

    await page.getByRole("button", { name: /^More actions for trade / }).click();
    await page.getByRole("dialog", { name: /^More actions for trade / }).getByRole("button", { name: "Delete", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Household settings → Recently deleted");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    const toast = page.getByRole("status");
    await expect(toast).toContainText("Moved to Recently deleted.");
    await expect(trades).toHaveCount(0);

    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(trades).toHaveCount(1);
  });
});

test.describe.serial("Trip segments go to Trash", () => {
  const title = `Trash stay ${Date.now()}`;

  test("deleting one offers Undo, which brings it back", async ({ page }) => {
    await addSegment(page, title);
    await deleteSegment(page, title);

    const toast = page.getByRole("status");
    await expect(toast).toContainText("Moved to Recently deleted.");
    await expect(page.locator("main")).not.toContainText(title);

    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("main")).toContainText(title);
  });

  test("a deleted one is listed in Trash and can be restored from there", async ({ page }) => {
    await page.goto(tripUrl);
    await deleteSegment(page, title);
    await expect(page.getByRole("status")).toContainText("Moved to Recently deleted.");

    await page.goto("/settings/trash");
    const row = page.locator("li", { hasText: title });
    await expect(row).toContainText("Trip segment");
    await row.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByRole("status")).toContainText("Restored.");

    await page.goto(tripUrl);
    await expect(page.locator("main")).toContainText(title);
  });

  test("it's only deleted for good from Trash", async ({ page }) => {
    await page.goto(tripUrl);
    await deleteSegment(page, title);
    await expect(page.getByRole("status")).toContainText("Moved to Recently deleted.");

    await page.goto("/settings/trash");
    const row = page.locator("li", { hasText: title });
    await row.getByRole("button", { name: "Delete permanently" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete permanently" }).click();
    await expect(page.locator("body")).not.toContainText(title);

    await page.goto(tripUrl);
    await expect(page.locator("main")).not.toContainText(title);
  });
});

// #618 (WCAG 2.2.1) — the Undo toast doesn't time out while the pointer is
// over it or focus is inside it, closes once both leave, and Escape still
// dismisses it at once without undoing, handing focus back where it was.
test.describe.serial("The Undo toast waits while it's in use", () => {
  test("stays up while hovered or focused, then times out once left", async ({ page }) => {
    // Fake timers from the start (time still flows normally until runFor),
    // so the toast's own timer is one the clock controls.
    await page.clock.install();
    const segment = `Toast wait ${Date.now()}`;
    await addSegment(page, segment);
    await deleteSegment(page, segment);

    const toast = page.getByRole("status");
    const message = toast.getByText("Moved to Recently deleted.");
    await expect(message).toBeVisible();

    await message.hover();
    await page.clock.runFor(20_000);
    await expect(message).toBeVisible();

    await toast.getByRole("button", { name: "Undo" }).focus();
    await page.mouse.move(0, 0);
    await page.clock.runFor(20_000);
    await expect(message).toBeVisible();

    // Neither hovered nor focused: the time it had left runs out.
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await page.clock.runFor(8_000);
    await expect(message).toHaveCount(0);
  });

  test("Escape dismisses it without undoing and returns focus", async ({ page }) => {
    const segment = `Toast escape ${Date.now()}`;
    await addSegment(page, segment);
    await deleteSegment(page, segment);

    const toast = page.getByRole("status");
    await expect(toast).toContainText("Moved to Recently deleted.");
    const undo = toast.getByRole("button", { name: "Undo" });
    await undo.focus();
    await page.keyboard.press("Escape");
    await expect(undo).toHaveCount(0);
    await expect(page.locator("body")).not.toBeFocused();

    await page.goto(tripUrl);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("main")).not.toContainText(segment);
  });
});

// The accessible name of the row menu after `title`'s in the trip's
// itinerary, or null when it is the last row.
async function rowMenuAfter(page: Page, title: string): Promise<string | null> {
  const itinerary = page
    .locator("[data-focus-list]")
    .filter({ has: page.getByRole("heading", { name: "Itinerary", exact: true }) });
  const names = await itinerary
    .getByRole("button", { name: /^More actions for / })
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
  const index = names.indexOf(`More actions for ${title}`);
  return index === -1 ? null : (names[index + 1] ?? null);
}

async function deleteSegmentByKeyboard(page: Page, title: string) {
  await page.getByRole("button", { name: `More actions for ${title}`, exact: true }).focus();
  await page.keyboard.press("Enter"); // opens the row menu, focus on Delete
  await page.keyboard.press("Enter"); // opens the confirm dialog, focus on Cancel
  await page.keyboard.press("Tab"); // to the dialog's Delete
  await page.keyboard.press("Enter");
}

// #631 (WCAG 2.2.1) — Alt+T (Option+T on a Mac) moves focus into the newest
// toast, so a keyboard user can reach Undo before it times out without
// tabbing through the page. Focus goes back where it was afterwards.
test.describe.serial("Alt+T reaches the newest toast", () => {
  test("a keyboard-only delete can be undone with Alt+T, Enter", async ({ page }) => {
    const segment = `Toast shortcut ${Date.now()}`;
    const neighbour = `${segment} neighbour`;
    await addSegment(page, segment);
    await addSegment(page, neighbour);
    const menu = page.getByRole("button", { name: `More actions for ${segment}`, exact: true });
    // #646 — focus goes to the row after the deleted one, whichever that is.
    const next = await rowMenuAfter(page, segment);
    expect(next).not.toBeNull();
    await deleteSegmentByKeyboard(page, segment);

    const toast = page.getByRole("status");
    await expect(toast).toContainText("Moved to Recently deleted.");
    await expect(menu).toHaveCount(0);
    // The deleted row held focus; it moves to the next row's menu instead of
    // dropping to <body>.
    const nextMenu = page.getByRole("button", { name: next!, exact: true });
    await expect(nextMenu).toBeFocused();

    await page.keyboard.press("Alt+KeyT");
    const undo = toast.getByRole("button", { name: "Undo" });
    await expect(undo).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(menu).toHaveCount(1);
    // Focus goes back to where it was before Alt+T.
    await expect(nextMenu).toBeFocused();

    await deleteSegment(page, neighbour);
    await expect(page.getByRole("button", { name: `More actions for ${neighbour}`, exact: true })).toHaveCount(0);
  });

  test("focus returns to where it was, and the toast waits while it holds focus", async ({ page }) => {
    await page.clock.install();
    const segment = `Toast shortcut return ${Date.now()}`;
    await addSegment(page, segment);
    await deleteSegmentByKeyboard(page, segment);

    const toast = page.getByRole("status");
    const message = toast.getByText("Moved to Recently deleted.");
    await expect(message).toBeVisible();

    const addLink = page.getByRole("link", { name: /add segment/i }).first();
    await addLink.focus();
    await page.keyboard.press("Alt+KeyT");
    await expect(toast.getByRole("button", { name: "Undo" })).toBeFocused();

    // Well past the 8 s an action toast normally gets.
    await page.clock.runFor(20_000);
    await expect(message).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(message).toHaveCount(0);
    await expect(addLink).toBeFocused();
  });

  test("tells screen-reader users about the shortcut", async ({ page }) => {
    const segment = `Toast shortcut hint ${Date.now()}`;
    await addSegment(page, segment);
    await deleteSegment(page, segment);
    await expect(page.getByRole("status")).toContainText("Press Alt+T to reach Undo.");
  });

  test("does nothing, and doesn't swallow the key, with no toast visible", async ({ page }) => {
    await page.goto(`${tripUrl}/segments/new`);
    const title = page.locator('input[name="title"]');
    await title.focus();
    await expect(page.getByRole("status")).toHaveCount(0);

    const prevented = await page.evaluate(() => {
      const event = new KeyboardEvent("keydown", { key: "t", code: "KeyT", altKey: true, bubbles: true, cancelable: true });
      document.activeElement?.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(false);
    await expect(title).toBeFocused();

    await page.keyboard.type("tent");
    await expect(title).toHaveValue("tent");
  });
});

// #646 — deleting a row with the keyboard hands focus to a neighbouring row,
// or to the list's Add button once it's empty, never to <body>. Cancelling
// still hands it back to where the delete started (#57).
test.describe.serial("Focus after a keyboard delete", () => {
  let ownTripUrl: string;

  async function addDatedSegment(page: Page, title: string, startDate: string) {
    await page.goto(`${ownTripUrl}/segments/new`);
    await page.locator('select[name="type"]').selectOption("ACTIVITY");
    await page.locator('input[name="title"]').fill(title);
    await page.locator('input[name="startDate"]').fill(startDate);
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(`**${ownTripUrl}`);
    await expect(page.getByRole("button", { name: `More actions for ${title}`, exact: true })).toBeVisible();
  }

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage({ storageState: ADMIN_AUTH_FILE });
    await page.goto("/travel/new");
    await page.locator("#title").fill(`Focus trip ${Date.now()}`);
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/travel\/(?!new$)[^/]+$/);
    ownTripUrl = new URL(page.url()).pathname;
    await page.close();
  });

  test("deleting the last row focuses the previous row's menu", async ({ page }) => {
    await addDatedSegment(page, "Focus first", "2026-03-01");
    await addDatedSegment(page, "Focus last", "2026-03-02");
    expect(await rowMenuAfter(page, "Focus first")).toBe("More actions for Focus last");

    await deleteSegmentByKeyboard(page, "Focus last");
    await expect(page.getByRole("status")).toContainText("Moved to Recently deleted.");
    await expect(page.getByRole("button", { name: "More actions for Focus last", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "More actions for Focus first", exact: true })).toBeFocused();
  });

  test("deleting the only row focuses the list's Add button", async ({ page }) => {
    await page.goto(ownTripUrl);
    await deleteSegmentByKeyboard(page, "Focus first");
    await expect(page.getByRole("status")).toContainText("Moved to Recently deleted.");
    await expect(page.locator("main")).toContainText("No segments yet.");
    await expect(page.getByRole("link", { name: "Add segment" })).toBeFocused();
    await expect(page.locator("body")).not.toBeFocused();
  });

  // Review of #650 — once focus has been handed on, it's the user's again: a
  // click somewhere else isn't undone by the next change to the page.
  test("a click after a mouse delete keeps focus where the user put it", async ({ page }) => {
    await addDatedSegment(page, "Focus click gone", "2026-03-04");
    await addDatedSegment(page, "Focus click next", "2026-03-05");
    await deleteSegment(page, "Focus click gone");
    await expect(page.getByRole("button", { name: "More actions for Focus click gone", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "More actions for Focus click next", exact: true })).toBeFocused();

    await page.getByRole("heading", { name: "Itinerary", exact: true }).click();
    await expect(page.locator("body")).toBeFocused();
    await page.evaluate(() => document.body.appendChild(document.createElement("div")));
    await page.waitForTimeout(200);
    await expect(page.locator("body")).toBeFocused();
  });

  test("cancelling the confirm dialog hands focus back to the row", async ({ page }) => {
    await addDatedSegment(page, "Focus kept", "2026-03-03");
    const menu = page.getByRole("button", { name: "More actions for Focus kept", exact: true });

    const rowMenu = page.getByRole("dialog", { name: "More actions for Focus kept" });
    const openConfirm = async () => {
      await menu.focus();
      await page.keyboard.press("Enter"); // opens the row menu, focus on Delete
      await page.keyboard.press("Enter"); // opens the confirm dialog, focus on Cancel
      await expect(page.getByRole("alertdialog")).toBeVisible();
    };

    // The Cancel button leaves the row menu open, so focus goes back to its
    // Delete item, as before.
    await openConfirm();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(rowMenu.getByRole("button", { name: "Delete", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();

    // Escape closes the row menu too, taking the Delete item with it, so the
    // row's ⋮ button stands in for it.
    await openConfirm();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(rowMenu).toHaveCount(0);
    await expect(menu).toBeFocused();
  });
});
