import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE, MEMBER_AUTH_FILE } from "../env";

// #151: Hearth is household-wide, but several paths still enforced per-user
// ownership via `createdById`, so a member could see a record in the UI and
// then be refused when editing, syncing or putting it on a calendar. These
// tests pin the intended model down from both sides:
//
//   - every household member can read, edit AND delete any household record,
//     regardless of who created it — role gates nothing here beyond READONLY,
//     which each domain's requireUser() already blocks from all writes;
//   - the calendar and iCal feed show the whole household, not one user's
//     slice of it.

const INVENTORY_ITEM = "Admin-created Drill";

test.describe("household-wide sharing", () => {
  test.describe.configure({ mode: "serial" });

  test("admin enables Inventory and creates an item", async ({ browser }) => {
    const context = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
    const page = await context.newPage();

    await page.goto("/settings/modules");
    const inventoryRow = page.locator("li", { hasText: "Inventory" });
    if (await inventoryRow.getByRole("button", { name: "Enable" }).count()) {
      await inventoryRow.getByRole("button", { name: "Enable" }).click();
      await expect(page.locator("body")).toContainText("Module enabled.");
    }

    await page.goto("/inventory/new");
    await page.locator("#label").fill(INVENTORY_ITEM);
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/inventory\/(?!new$)[^/]+$/);
    await expect(page.locator("body")).toContainText(INVENTORY_ITEM);

    await context.close();
  });

  test("a member can edit an inventory item the admin created", async ({ browser }) => {
    const context = await browser.newContext({ storageState: MEMBER_AUTH_FILE });
    const page = await context.newPage();

    await page.goto("/inventory");
    await expect(page.locator("body")).toContainText(INVENTORY_ITEM);

    await page.getByText(INVENTORY_ITEM).first().click();
    await page.waitForURL(/\/inventory\/(?!new$)[^/]+$/);
    const itemUrl = page.url();

    // Before #151 this returned "Item not found." — the update action compared
    // createdById against the session user.
    await page.goto(`${itemUrl}/edit`);
    await page.locator("#label").fill("Member-edited Drill");
    await page.locator("main button[type=submit]").click();
    await page.waitForURL(/\/inventory\/(?!new$)[^/]+$/);
    await expect(page.locator("body")).toContainText("Member-edited Drill");

    await context.close();
  });

  test("a member can delete an item the admin created", async ({ browser }) => {
    const context = await browser.newContext({ storageState: MEMBER_AUTH_FILE });
    const page = await context.newPage();

    await page.goto("/inventory");
    await page.getByText("Member-edited Drill").first().click();
    await page.waitForURL(/\/inventory\/(?!new$)[^/]+$/);

    // Deleting is not admin-gated: a member who can edit a shared record can
    // also remove it, subject only to the READONLY role.
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("button", { name: /Delete/ }).click();
    await page.getByRole("button", { name: "Confirm" }).click();

    await page.waitForURL(/\/inventory$/);
    await expect(page.locator("body")).not.toContainText("Member-edited Drill");

    await context.close();
  });

});

test("the calendar shows records created by other household members", async ({ browser }) => {
  const adminContext = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
  const adminPage = await adminContext.newPage();

  // A contract with an end date is enough to produce a calendar entry.
  await adminPage.goto("/contracts/new");
  await adminPage.locator("#title").fill("Admin Household Policy");
  await adminPage.locator("#provider").fill("Shared Insurer");
  await adminPage.locator("#endDate").fill("2027-03-15");
  await adminPage.locator("main button[type=submit]").click();
  await adminPage.waitForURL(/\/contracts\/(?!new$)[^/]+$/);
  await adminContext.close();

  // Before #151 getCalendarEvents filtered on createdById, so the member's
  // calendar silently omitted this entirely.
  const memberContext = await browser.newContext({ storageState: MEMBER_AUTH_FILE });
  const memberPage = await memberContext.newPage();
  await memberPage.goto("/calendar");
  await expect(memberPage.locator("body")).toContainText("Admin Household Policy");
  await memberContext.close();
});

test("the iCal feed covers the whole household, whichever member's token is used", async ({
  browser,
}) => {
  const memberContext = await browser.newContext({ storageState: MEMBER_AUTH_FILE });
  const memberPage = await memberContext.newPage();

  await memberPage.goto("/settings");
  await memberPage
    .getByRole("button", { name: /Create calendar feed|Generate new URL/i })
    .click();

  // Only stored as a hash, so the URL appears exactly once — right here.
  const feedInput = memberPage.locator('section:has-text("Calendar feed") input[readonly]');
  await expect(feedInput).toBeVisible();
  const feedUrl = await feedInput.inputValue();
  expect(feedUrl).toContain("/api/ical?token=");

  // The token says which member subscribed; it must not narrow the feed to
  // that member's own rows.
  const response = await memberPage.request.get(feedUrl);
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain("Admin Household Policy");

  // A calendar client has no session. Before /api/ical was made public this
  // 307'd to /login — and carried the token into the login URL's query string.
  const anonContext = await browser.newContext();
  const anonResponse = await anonContext.request.get(feedUrl);
  expect(anonResponse.status()).toBe(200);
  expect(anonResponse.headers()["cache-control"]).toContain("no-store");
  expect(anonResponse.headers()["referrer-policy"]).toBe("no-referrer");
  expect(await anonResponse.text()).toContain("Admin Household Policy");

  // A wrong token must not fall back to some other user's feed.
  const badResponse = await anonContext.request.get(
    feedUrl.replace(/token=.*/, "token=not-a-real-token"),
  );
  expect(badResponse.status()).toBe(401);
  await anonContext.close();

  // Revisiting Settings can't reproduce the URL.
  await memberPage.reload();
  await expect(
    memberPage.locator('section:has-text("Calendar feed") input[readonly]'),
  ).toHaveCount(0);
  await expect(memberPage.locator("body")).toContainText("A calendar feed is active");

  await memberContext.close();
});
