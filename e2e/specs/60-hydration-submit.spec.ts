import { test, expect, type Browser } from "@playwright/test";
import { createClient, type Client } from "@libsql/client";
import { ADMIN_AUTH_FILE, ADMIN_EMAIL, DATABASE_URL } from "../env";

// #609: a click that lands before React hydrates submits a server-action
// form natively. The app sends Referrer-Policy: no-referrer, so that POST
// carries `Origin: null`, Next rejects the action and the click is lost: on
// the calendar feed the one-time URL never appeared. Submit buttons stay
// disabled until hydration, so no such POST is sent.
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

test("Create calendar feed is disabled before hydration and a click sends nothing", async ({ browser }) => {
  const page = await unhydratedPage(browser, "/settings");
  const main = page.locator("main");
  // The row is a native <details>, so it opens without JavaScript.
  await main.getByText("Calendar feed", { exact: true }).click();
  const createFeed = main.getByRole("button", { name: /Create calendar feed|Generate new URL/ });
  await expect(createFeed).toBeVisible();
  await expect(createFeed).toBeDisabled();

  const before = await adminIcalHash();
  // force skips Playwright's wait for enabled; the browser ignores a click on
  // a disabled button, so no form POST may follow. On main the enabled button
  // posts the form within milliseconds; two seconds is a wide margin.
  const post = page
    .waitForEvent("request", { predicate: (r) => r.method() === "POST", timeout: 2_000 })
    .then((r) => r.url())
    .catch(() => null);
  await createFeed.click({ force: true });
  expect(await post).toBeNull();
  // A backstop only: the server refuses a native submit anyway, so this
  // also holds on main.
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

  const response = await page.goto("/settings");
  // Without the script the buttons never enable, so the page says why.
  // Playwright's JS switch doesn't make Chromium render <noscript>, so check
  // the served HTML rather than what's on screen.
  expect(await response?.text()).toMatch(/<noscript>(?:(?!<\/noscript>)[\s\S])*Hearth needs JavaScript\./);
  await main.getByText("Password", { exact: true }).click();
  await expect(main.getByRole("button", { name: "Update password" })).toBeDisabled();

  // Enter in a field submits through the form's default button; with that
  // button disabled, no POST is sent.
  const post = page
    .waitForEvent("request", { predicate: (r) => r.method() === "POST", timeout: 2_000 })
    .then((r) => r.url())
    .catch(() => null);
  await main.locator('input[type="password"]').first().press("Enter");
  expect(await post).toBeNull();

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
