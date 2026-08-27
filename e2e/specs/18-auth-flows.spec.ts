import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

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
});
