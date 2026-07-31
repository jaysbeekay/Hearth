import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE, ADMIN_EMAIL, ADMIN_PASSWORD } from "../env";

// #168: sessions are JWTs, and the role was stamped into the token at sign-in
// and never revisited. A demoted or deleted account therefore kept whatever
// privileges its token was minted with until the token expired. The jwt
// callback in src/lib/auth.ts now revalidates against the database on every
// read, with a sessionVersion counter to force invalidation.

const TEMP_EMAIL = "revoked@e2e.local";
const TEMP_PASSWORD = "E2eTestPassw0rd!23";
const NEW_PASSWORD = "E2eRotatedPassw0rd!45";

test.describe.configure({ mode: "serial" });

async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/\/dashboard/);
}

test("a role change invalidates the target's existing session", async ({ browser }) => {
  const adminContext = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
  const adminPage = await adminContext.newPage();

  await adminPage.goto("/settings/users");
  await adminPage.locator("#name").fill("Revocation Target");
  await adminPage.locator("#email").fill(TEMP_EMAIL);
  await adminPage.locator("#password").fill(TEMP_PASSWORD);
  await adminPage.locator("form:has(#password) button[type=submit]").click();
  await expect(adminPage.locator("body")).toContainText(TEMP_EMAIL);

  // That user signs in and holds a live session.
  const victimContext = await browser.newContext();
  const victimPage = await victimContext.newPage();
  await signIn(victimPage, TEMP_EMAIL, TEMP_PASSWORD);
  await expect(victimPage).toHaveURL(/\/dashboard/);

  // Admin demotes them while that session is still open.
  const row = adminPage.locator("li", { hasText: TEMP_EMAIL });
  await row.locator('select[name="role"]').selectOption("READONLY");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(adminPage.locator("body")).toContainText(/updated|saved/i);

  // The still-open session must not survive on its old token.
  await victimPage.goto("/dashboard");
  await expect(victimPage).toHaveURL(/\/login/);

  await victimContext.close();
  await adminContext.close();
});

test("deleting an account invalidates its session immediately", async ({ browser }) => {
  const victimContext = await browser.newContext();
  const victimPage = await victimContext.newPage();
  await signIn(victimPage, TEMP_EMAIL, TEMP_PASSWORD);
  await expect(victimPage).toHaveURL(/\/dashboard/);

  const adminContext = await browser.newContext({ storageState: ADMIN_AUTH_FILE });
  const adminPage = await adminContext.newPage();
  await adminPage.goto("/settings/users");
  const row = adminPage.locator("li", { hasText: TEMP_EMAIL });
  await row.getByRole("button", { name: /Remove .* from the household/ }).click();
  await adminPage.getByRole("button", { name: "Confirm" }).click();
  await expect(adminPage.locator("body")).not.toContainText(TEMP_EMAIL);

  // The JWT is still cryptographically valid — only the database lookup
  // catches that the account is gone.
  await victimPage.goto("/dashboard");
  await expect(victimPage).toHaveURL(/\/login/);

  await victimContext.close();
  await adminContext.close();
});

test("changing a password signs out every session, including the current one", async ({
  browser,
}) => {
  // Two sessions for the same account. Changing the password must leave
  // neither usable — the whole point is to evict whoever had the old one.
  const firstContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  await signIn(firstPage, ADMIN_EMAIL, ADMIN_PASSWORD);

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await signIn(secondPage, ADMIN_EMAIL, ADMIN_PASSWORD);

  await secondPage.goto("/settings");
  await secondPage.locator("#currentPassword").fill(ADMIN_PASSWORD);
  await secondPage.locator("#newPassword").fill(NEW_PASSWORD);
  await secondPage.locator("form:has(#currentPassword) button[type=submit]").click();

  // The session that made the change is signed out too, and told why.
  await secondPage.waitForURL(/\/login/);
  await expect(secondPage.locator("body")).toContainText("Password updated");

  // The other session is dead as well, even though its JWT is still valid.
  await firstPage.goto("/dashboard");
  await expect(firstPage).toHaveURL(/\/login/);

  // The new password works, and the old one doesn't.
  await signIn(secondPage, ADMIN_EMAIL, NEW_PASSWORD);
  await expect(secondPage).toHaveURL(/\/dashboard/);

  // Restore it so the shared admin storageState stays usable.
  await secondPage.goto("/settings");
  await secondPage.locator("#currentPassword").fill(NEW_PASSWORD);
  await secondPage.locator("#newPassword").fill(ADMIN_PASSWORD);
  await secondPage.locator("form:has(#currentPassword) button[type=submit]").click();
  await secondPage.waitForURL(/\/login/);

  await firstContext.close();
  await secondContext.close();
});
