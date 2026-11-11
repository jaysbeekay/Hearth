import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

// My account and Household settings rows are <details> that drop down in
// place. A closed row must never hide feedback: it opens for a URL fragment
// that names it or a field in it, for a field the browser flags, and for an
// error the server sends back.

test.use({ storageState: ADMIN_AUTH_FILE });

function row(page: Page, id: string) {
  return page.locator(`details#${id}`);
}

async function isOpen(page: Page, id: string) {
  return row(page, id).evaluate((el) => (el as HTMLDetailsElement).open);
}

test("a URL fragment opens the row it names, or the row holding the field it names", async ({ page }) => {
  await page.goto("/settings#preferences");
  await expect.poll(() => isOpen(page, "preferences")).toBe(true);
  expect(await isOpen(page, "password")).toBe(false);

  // A field inside a row, and a fragment changed after load.
  await page.evaluate(() => {
    window.location.hash = "#currentPassword";
  });
  await expect.poll(() => isOpen(page, "password")).toBe(true);
  await expect(page.locator("#currentPassword")).toBeVisible();
});

test("Save changes opens a closed row whose field the browser flags, and points at the field", async ({ page }) => {
  await page.goto("/settings#preferences");
  await expect.poll(() => isOpen(page, "preferences")).toBe(true);
  const dateFormat = page.locator("#dateFormat");
  const other = await dateFormat.evaluate(
    (el) => [...(el as HTMLSelectElement).options].find((o) => !o.selected)?.value ?? "",
  );
  await dateFormat.selectOption(other);
  // Stand in for any constraint the browser enforces.
  await dateFormat.evaluate((el) => {
    (el as HTMLSelectElement).setCustomValidity("Pick a date format.");
  });
  await row(page, "preferences").locator("summary").click();
  expect(await isOpen(page, "preferences")).toBe(false);

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => isOpen(page, "preferences")).toBe(true);
  await expect(dateFormat).toBeVisible();
  await expect(dateFormat).toBeFocused();
  // Not sent: the browser's validation stopped it.
  await expect(page.getByText("You have unsaved changes.")).toBeVisible();
});

test("an error the server sends back opens the closed row it belongs to", async ({ page }) => {
  await page.goto("/settings/household#timezone");
  await expect.poll(() => isOpen(page, "timezone")).toBe(true);
  const select = page.locator("#householdTimeZone");
  // A value the server rejects ("Invalid timezone."), so nothing is saved.
  await select.evaluate((el) => {
    const option = document.createElement("option");
    option.value = "Not/AZone";
    option.textContent = "Not/AZone";
    el.appendChild(option);
  });
  await select.selectOption("Not/AZone");
  await row(page, "timezone").locator("summary").click();
  expect(await isOpen(page, "timezone")).toBe(false);

  await page.getByRole("button", { name: "Save changes" }).click();
  const error = row(page, "timezone").getByRole("alert");
  // #615 — the error starts with a visually hidden "Error:" for screen readers.
  await expect(error).toHaveText("Error: Invalid timezone.");
  await expect(error).toBeVisible();
  expect(await isOpen(page, "timezone")).toBe(true);
});
