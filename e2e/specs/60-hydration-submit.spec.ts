import { test, expect, type Browser } from "@playwright/test";
import { createClient, type Client } from "@libsql/client";
import { ADMIN_AUTH_FILE, ADMIN_EMAIL, DATABASE_URL } from "../env";

// #609: a useActionState form's result lives in client state. A click that
// lands before React hydrates submits the form natively instead, so the
// action runs but its result is never shown. For the calendar feed that
// meant a fresh token (replacing the old feed) whose one-time URL the user
// never saw. Submit buttons on these forms stay disabled until hydration.
//
// A page with JavaScript turned off is the page as served, before
// hydration: what a slow device shows for its first seconds.

let db: Client;

test.beforeAll(async () => {
  db = createClient({ url: DATABASE_URL });
  await db.execute("PRAGMA busy_timeout = 5000");
});

test.afterAll(() => {
  db.close();
});

async function unhydratedPage(browser: Browser, path: string) {
  const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE, javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

async function adminIcalHash(): Promise<unknown> {
  const result = await db.execute({ sql: "SELECT icalToken FROM users WHERE email = ?", args: [ADMIN_EMAIL] });
  return result.rows[0]?.icalToken ?? null;
}

test("a click on Create calendar feed before hydration mints no token", async ({ browser }) => {
  const page = await unhydratedPage(browser, "/settings");
  const main = page.locator("main");
  // The row is a native <details>, so it opens without JavaScript.
  await main.getByText("Calendar feed", { exact: true }).click();
  const createFeed = main.getByRole("button", { name: /Create calendar feed|Generate new URL/ });
  await expect(createFeed).toBeVisible();
  await expect(createFeed).toBeDisabled();

  const before = await adminIcalHash();
  // force skips Playwright's wait for enabled; the browser still ignores a
  // click on a disabled button, which is the point.
  await createFeed.click({ force: true });
  await page.waitForLoadState("load");
  expect(await adminIcalHash()).toEqual(before);

  await page.context().close();
});

test("the other useActionState submit buttons wait for hydration too", async ({ browser }) => {
  // SubmitButton (every form that shows a pending state) and the hand-rolled
  // submit buttons on useActionState forms: the member role Save here.
  const page = await unhydratedPage(browser, "/settings/users");
  const main = page.locator("main");
  const roleSave = main.getByRole("button", { name: "Save", exact: true }).first();
  await expect(roleSave).toBeDisabled();

  await page.goto("/settings");
  await main.getByText("Password", { exact: true }).click();
  await expect(main.getByRole("button", { name: "Update password" })).toBeDisabled();

  await page.context().close();
});

test("once hydrated, the calendar feed button works on the first click", async ({ browser }) => {
  const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
  const page = await context.newPage();
  await page.goto("/settings#calendar-feed");
  // No wait for hydration here: click() waits for the button to be enabled,
  // which is the app's own signal that the click will be handled.
  await page.getByRole("button", { name: /Create calendar feed|Generate new URL/ }).click();
  await expect(page.locator("#calendar-feed input[readonly]")).toHaveValue(/\/api\/ical\?token=/);
  await context.close();
});
