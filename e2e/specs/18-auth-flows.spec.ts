import { createHash, randomBytes, randomUUID } from "crypto";
import { test, expect, type Browser } from "@playwright/test";
import { createClient } from "@libsql/client";
import { ADMIN_AUTH_FILE, DATABASE_URL } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

test.describe("password reset and invitation flows", () => {
  // #261: SMTP isn't configured in this e2e environment, so createUser takes
  // the password-based branch (an admin sets the new member's password
  // directly) rather than the email-invitation branch — the same path
  // 12-session-revocation.spec.ts's "Revocation Target" setup already relies
  // on. There's no way to reach the email-invitation/APP_URL-check branch
  // without SMTP configured, so this covers the branch that's actually live.
  test("an admin can add a household member by setting their password directly", async ({
    page,
  }) => {
    await page.goto("/settings/users");
    await page.locator("#name").fill("Auth Flow Test User");
    await page.locator("#email").fill("auth-flow-test@e2e.local");
    await page.locator("#password").fill("TestPassword123!");
    await page.locator('form:has(#password) button[type=submit]').click();

    await expect(page.locator("body")).toContainText("Auth Flow Test User was added.");
    await expect(page.locator("body")).toContainText("auth-flow-test@e2e.local");
  });

  // /forgot-password's form is gated on SMTP being configured (there'd be
  // nowhere for a reset email to come from otherwise — LoginForm hides its
  // "Forgot your password?" link on the same condition) — with no SMTP_*
  // set here, the whole request/email/reset-link round trip is unreachable
  // through the UI in this environment. What's still live and worth
  // covering: the graceful degradation message this page shows instead, and
  // the reset-password page's invalid-token rendering, which doesn't depend
  // on SMTP at all. The actual single-use/expiry token logic is
  // unit-tested directly (tests/unit/auth-tokens.test.ts).
  test("forgot-password degrades gracefully without SMTP configured, and an invalid reset token is rejected", async ({
    page,
  }) => {
    await page.goto("/forgot-password");
    await expect(page.locator("body")).toContainText(
      "Password reset emails aren't set up for this household yet.",
    );
    await expect(page.locator("#email")).toHaveCount(0);

    await page.goto("/reset-password/not-a-real-token");
    await expect(page.locator("body")).toContainText(
      "This reset link is invalid or has expired.",
    );
  });

  // #372 — with SMTP off the invite and reset emails can't be sent, so these
  // seed the one-time token straight into the database (hashed, as the app
  // stores it) and follow the link a member would get.
  async function seedTokenFor(purpose: "INVITE" | "RESET", email: string, name: string, totpEnabled = false) {
    const db = createClient({ url: DATABASE_URL });
    await db.execute("PRAGMA busy_timeout = 5000");
    await db.execute({ sql: "DELETE FROM users WHERE email = ?", args: [email] });
    const userId = randomUUID();
    const now = new Date().toISOString().replace("Z", "+00:00");
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace("Z", "+00:00");
    await db.execute({
      sql: "INSERT INTO users (id, name, email, passwordHash, role, totpEnabled, createdAt) VALUES (?, ?, ?, ?, 'MEMBER', ?, ?)",
      // Not a usable bcrypt hash: the invite or reset sets the real one.
      args: [userId, name, email, "!", totpEnabled ? 1 : 0, now],
    });
    const token = randomBytes(32).toString("hex");
    await db.execute({
      sql: "INSERT INTO password_reset_tokens (id, token, userId, purpose, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      args: [randomUUID(), createHash("sha256").update(token).digest("hex"), userId, purpose, expires, now],
    });
    return {
      token,
      cleanup: async () => {
        await db.execute({ sql: "DELETE FROM users WHERE id = ?", args: [userId] });
        db.close();
      },
    };
  }

  async function signedOutPage(browser: Browser) {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    return { context, page: await context.newPage() };
  }

  test("accepting an invitation signs the member in on Upcoming with a one-time welcome", async ({ browser }) => {
    const { token, cleanup } = await seedTokenFor("INVITE", "invite-372@e2e.local", "Invite Flow Member");
    const { context, page } = await signedOutPage(browser);
    try {
      await page.goto(`/accept-invitation/${token}`);
      await page.locator("#password").fill("InvitePassw0rd!372");
      await page.getByRole("button", { name: "Set password" }).click();
      await page.waitForURL(/\/calendar\?welcome=1$/);
      await expect(page.getByRole("heading", { name: "Upcoming", level: 1 })).toBeVisible();

      const welcome = page.getByRole("status").filter({ hasText: "Welcome." });
      await expect(welcome).toContainText("You're a Member of this household.");
      await expect(welcome).toContainText("You can add, edit, and delete shared household records.");
      await welcome.getByRole("button", { name: "Dismiss welcome" }).click();
      await expect(welcome).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Upcoming", level: 1 })).toBeVisible();
      await expect(page.getByText("You're a Member of this household.")).toHaveCount(0);

      // The link is spent.
      await page.goto(`/accept-invitation/${token}`);
      await expect(page.locator("body")).toContainText("This invitation link is invalid or has expired.");
    } finally {
      await context.close();
      await cleanup();
    }
  });

  test("resetting a password sends the person to sign in with the new one", async ({ browser }) => {
    const { token, cleanup } = await seedTokenFor("RESET", "reset-372@e2e.local", "Reset Flow Member");
    const { context, page } = await signedOutPage(browser);
    try {
      await page.goto(`/reset-password/${token}`);
      await page.locator("#password").fill("ResetPassw0rd!372");
      await page.getByRole("button", { name: "Reset password" }).click();
      await expect(page.locator("body")).toContainText("Password updated. You can now sign in.");
      await page.getByRole("link", { name: "Continue to sign in" }).click();
      await page.waitForURL(/\/login$/);
      await page.locator("#email").fill("reset-372@e2e.local");
      await page.locator("#password").fill("ResetPassw0rd!372");
      await Promise.all([
        page.waitForURL((url) => url.pathname !== "/login"),
        page.getByRole("button", { name: "Sign in" }).click(),
      ]);
    } finally {
      await context.close();
      await cleanup();
    }
  });

  test("resetting a password with two-factor on still asks for the code at sign-in", async ({ browser }) => {
    const { token, cleanup } = await seedTokenFor("RESET", "reset-totp-372@e2e.local", "Reset TOTP Member", true);
    const { context, page } = await signedOutPage(browser);
    try {
      await page.goto(`/reset-password/${token}`);
      await page.locator("#password").fill("ResetPassw0rd!372");
      await page.getByRole("button", { name: "Reset password" }).click();
      await expect(page.locator("body")).toContainText("Password updated. You can now sign in.");
      expect(new URL(page.url()).pathname).toBe(`/reset-password/${token}`);
    } finally {
      await context.close();
      await cleanup();
    }
  });
});
