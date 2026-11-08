"use server";

import bcrypt from "bcryptjs";
import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { AuthError, CredentialsSignin } from "next-auth";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { auth, signIn, signOut } from "@/lib/auth";
import {
  changePasswordSchema,
  createUserSchema,
  createUserWithPasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  setupSchema,
  updateMemberRoleSchema,
} from "@/lib/validation/auth";
import { formDataToStringValues } from "@/lib/form-state";
import { isKnownModuleKey } from "@/lib/modules/enablement";
import type { ModuleKey } from "@/lib/modules/registry";
import { DATE_FORMAT_OPTIONS, REGION_OPTIONS } from "@/lib/utils";
import { isUserTimeZoneOption } from "@/lib/timezones";
import { POPULAR_CURRENCIES } from "@/lib/currencyCodes";
import { env, isAppUrlConfigured, isSetupTokenRequired } from "@/lib/env";
import { generateToken, hashToken } from "@/lib/crypto";
import { buildConfiguredAppUrl, isUsableOneTimeToken } from "@/lib/authTokens";
import {
  checkRateLimit,
  clientAddress,
  consumeRateLimit,
  RATE_LIMITS,
  recordFailedAttempt,
  resetRateLimit,
} from "@/lib/rateLimit";
import { getHouseholdCurrency, isSmtpConfigured } from "@/lib/appSettings";
import { sendInvitationEmail, sendPasswordResetEmail } from "@/lib/notifications/email";
import { logSecurityEvent } from "@/lib/securityEventLog";
import { safeCallbackPath } from "@/lib/callbackUrl";
import { issueState } from "@/lib/validation/issues";
import { pushEndpointSchema } from "@/lib/validation/push";

export type ActionState = {
  error?: string;
  /** #406 — the form field `error` belongs to; shown under that field. */
  field?: string;
  success?: string;
  values?: Record<string, string>;
  totpRequired?: boolean;
} | null;

// Password is intentionally excluded — never echo it back to the form.
const CREATE_USER_FORM_FIELDS = ["name", "email", "role"];


// Thrown inside the setup transaction to roll it back when another request won
// the race; carried as a class so it can be told apart from a real DB failure.
class SetupAlreadyCompletedError extends Error {}

// Compares two secrets without leaking their contents through response timing.
// Lengths are hashed first so unequal-length inputs don't throw and don't
// reveal the expected length either.
function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function setupAdmin(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Cheap pre-check purely so an already-configured instance answers fast; the
  // authoritative check is the transaction below, which can't be raced.
  if ((await prisma.user.count()) > 0) {
    return { error: "Setup has already been completed." };
  }

  // A server exposed to the network before anyone has registered is claimable
  // by whoever reaches /setup first. Setting SETUP_TOKEN closes that window.
  if (isSetupTokenRequired()) {
    const provided = formData.get("setupToken");
    if (typeof provided !== "string" || !secretsMatch(provided, env.setupToken)) {
      return { error: "Invalid setup token." };
    }
  }

  const parsed = setupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ...issueState(parsed.error) };
  }

  const selectedModules = formData
    .getAll("modules")
    .filter((value) => typeof value === "string" && isKnownModuleKey(value)) as ModuleKey[];

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);

  // Re-check inside the write transaction. Two requests arriving together
  // would both pass the check above; only one can commit this.
  try {
    await prisma.$transaction(async (tx) => {
      if ((await tx.user.count()) > 0) {
        throw new SetupAlreadyCompletedError();
      }

      await tx.user.create({
        data: {
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash,
          role: "ADMIN",
        },
      });

      if (selectedModules.length > 0) {
        await tx.moduleEnablement.createMany({
          data: selectedModules.map((key) => ({ key, enabled: true })),
        });
      }
    });
  } catch (error) {
    if (error instanceof SetupAlreadyCompletedError) {
      return { error: "Setup has already been completed." };
    }
    throw error;
  }

  console.log(
    `[security] first-run setup completed — admin account created for ${parsed.data.email}`,
  );

  await signIn("credentials", {
    email: parsed.data.email,
    password: parsed.data.password,
    redirectTo: "/dashboard",
  });

  return null;
}

export async function login(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Enter a valid email and password." };
  }

  const totpCodeRaw = formData.get("totpCode");
  const totpCode = typeof totpCodeRaw === "string" ? totpCodeRaw.trim() : "";

  // Keyed by account *and* address: keying on the account alone would let an
  // attacker lock every household member out by guessing against each in
  // turn, and keying on the address alone would lock out a whole household
  // behind one NAT.
  const requestHeaders = await headers();
  const address = clientAddress(requestHeaders);
  const throttleKey = `${parsed.data.email}|${address}`;
  // #341 — re-validated here rather than trusted from the hidden field: it's
  // client-supplied, and an unchecked value would make this an open redirect.
  const redirectTo = safeCallbackPath(
    formData.get("callbackUrl"),
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
  const limitName = totpCode ? "totp" : "login";
  // Only failures count — see checkRateLimit's note. A successful signIn()
  // throws a redirect, so an attempt-counting model would never get to clear
  // the counter and would throttle ordinary repeated sign-ins.
  const throttle = checkRateLimit(limitName, throttleKey);
  if (!throttle.allowed) {
    await logSecurityEvent({
      type: "LOGIN_THROTTLED",
      email: parsed.data.email,
      address,
    });
    const minutes = Math.ceil(throttle.retryAfterSeconds / 60);
    return {
      error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      ...(totpCode ? { totpRequired: true } : {}),
    };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      // Omitted (rather than passed as undefined) when empty: signIn() builds
      // a URLSearchParams from this object, which stringifies `undefined` to
      // the literal text "undefined" — a truthy value the server would then
      // try (and fail) to verify as a real code instead of treating it as
      // absent.
      ...(totpCode ? { totpCode } : {}),
      redirectTo,
    });
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      // "TOTP required" isn't a failed guess — the password was right and the
      // form is simply asking for the second factor next.
      if (error.code === "totp_required") {
        resetRateLimit("login", throttleKey);
        return { totpRequired: true };
      }
      if (error.code === "invalid_totp") {
        recordFailedAttempt("totp", throttleKey);
        return {
          totpRequired: true,
          error: "Invalid code. Check your authenticator app or use a recovery code.",
        };
      }
    }
    if (error instanceof AuthError) {
      recordFailedAttempt(limitName, throttleKey);
      await logSecurityEvent({
        type: "LOGIN_FAILED",
        email: parsed.data.email,
        address,
      });
      return { error: "Invalid email or password." };
    }
    // Anything else is the success-path redirect NextAuth throws, or a real
    // fault — neither is a failed credential guess.
    throw error;
  }

  return null;
}

// #453 — a new member starts with the household currency, if the
// preferences select offers it (otherwise the schema default applies).
async function newMemberCurrency(): Promise<string | undefined> {
  const currency = await getHouseholdCurrency();
  return (POPULAR_CURRENCIES as readonly string[]).includes(currency) ? currency : undefined;
}

export async function createUser(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (session?.user.role !== "ADMIN") {
    return { error: "Only admins can add household members." };
  }

  const smtpOn = await isSmtpConfigured();

  if (!smtpOn) {
    const parsed = createUserWithPasswordSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
      role: formData.get("role") || "MEMBER",
    });
    if (!parsed.success) {
      return {
        ...issueState(parsed.error),
        values: formDataToStringValues(formData, CREATE_USER_FORM_FIELDS),
      };
    }

    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) {
      return {
        error: "A user with that email already exists.",
        values: formDataToStringValues(formData, CREATE_USER_FORM_FIELDS),
      };
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    await prisma.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
        role: parsed.data.role,
        preferredCurrency: await newMemberCurrency(),
      },
    });

    revalidatePath("/settings/users");
    return { success: `${parsed.data.name} was added.` };
  }

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role") || "MEMBER",
  });
  if (!parsed.success) {
    return {
      ...issueState(parsed.error),
      values: formDataToStringValues(formData, CREATE_USER_FORM_FIELDS),
    };
  }

  if (!isAppUrlConfigured()) {
    return {
      error:
        "APP_URL isn't set — the invitation link would point to http://localhost:3000, which the invitee can't reach. Set APP_URL to this app's real address first (see .env.example).",
      values: formDataToStringValues(formData, CREATE_USER_FORM_FIELDS),
    };
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return {
      error: "A user with that email already exists.",
      values: formDataToStringValues(formData, CREATE_USER_FORM_FIELDS),
    };
  }

  // SMTP is configured: the admin never sets a password directly. Generate
  // a random, unusable placeholder hash and send an invitation link instead.
  const placeholderHash = await bcrypt.hash(randomUUID() + randomUUID(), 12);
  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash: placeholderHash,
      role: parsed.data.role,
      preferredCurrency: await newMemberCurrency(),
    },
  });

  // Only the hash is stored — a leaked database snapshot shouldn't yield
  // working invitation links.
  const token = generateToken();
  await prisma.passwordResetToken.create({
    data: {
      tokenHash: hashToken(token),
      userId: user.id,
      purpose: "INVITE",
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    },
  });

  revalidatePath("/settings/users");
  try {
    await sendInvitationEmail(user.email, buildConfiguredAppUrl(env.appUrl, `/accept-invitation/${token}`)!);
  } catch (error) {
    return {
      error: `${parsed.data.name} was added, but the invitation email failed to send (${
        error instanceof Error ? error.message : "unknown error"
      }). Check your SMTP settings.`,
    };
  }

  return { success: `${parsed.data.name} was invited — an email was sent to set up their account.` };
}

export async function deleteUser(userId: string): Promise<ActionState> {
  const session = await auth();
  if (session?.user.role !== "ADMIN") {
    return { error: "Only admins can remove household members." };
  }
  if (session.user.id === userId) {
    return { error: "You can't remove your own account." };
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { error: "User not found." };

  if (target.role === "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) {
      return { error: "At least one admin must remain." };
    }
  }

  await prisma.user.delete({ where: { id: userId } });
  await logSecurityEvent({
    type: "USER_DELETED",
    userId,
    email: target.email,
    detail: `deleted by ${session.user.id}`,
  });
  revalidatePath("/settings/users");
  return { success: "User removed." };
}

export async function updateMemberRole(
  userId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (session?.user.role !== "ADMIN") {
    return { error: "Only admins can change member roles." };
  }
  if (session.user.id === userId) {
    return { error: "You can't change your own role." };
  }

  const parsed = updateMemberRoleSchema.safeParse({ role: formData.get("role") });
  if (!parsed.success) {
    return { ...issueState(parsed.error) };
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return { error: "User not found." };

  if (target.role === "ADMIN" && parsed.data.role !== "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) {
      return { error: "At least one admin must remain." };
    }
  }

  // A demotion has to take effect immediately, not whenever the target's JWT
  // happens to expire — their token carries the old role until reissued.
  await prisma.user.update({
    where: { id: userId },
    data: { role: parsed.data.role, sessionVersion: { increment: 1 } },
  });
  await logSecurityEvent({
    type: "ROLE_CHANGED",
    userId,
    email: target.email,
    detail: `role → ${parsed.data.role} (by ${session.user.id})`,
  });
  revalidatePath("/settings/users");
  return { success: "Role updated." };
}

export async function updateNotificationPreferences(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user) return { error: "Not signed in." };

  await prisma.user.update({
    where: { id: session.user.id },
    data: { emailReminders: formData.get("emailReminders") === "on" },
  });
  revalidatePath("/settings");
  return { success: "Notification preferences saved." };
}

export async function updateUserPreferences(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user) return { error: "Not signed in." };

  const dateFormat = formData.get("dateFormat");
  const preferredCurrency = formData.get("preferredCurrency");
  const timezone = formData.get("timezone");
  const region = formData.get("region");

  if (
    typeof dateFormat !== "string" ||
    !DATE_FORMAT_OPTIONS.includes(dateFormat as (typeof DATE_FORMAT_OPTIONS)[number])
  ) {
    return { error: "Invalid date format." };
  }
  if (
    typeof preferredCurrency !== "string" ||
    !POPULAR_CURRENCIES.includes(preferredCurrency as (typeof POPULAR_CURRENCIES)[number])
  ) {
    return { error: "Invalid currency." };
  }
  if (!isUserTimeZoneOption(timezone)) {
    return { error: "Invalid timezone." };
  }
  if (
    typeof region !== "string" ||
    !REGION_OPTIONS.includes(region as (typeof REGION_OPTIONS)[number])
  ) {
    return { error: "Invalid region." };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { dateFormat, preferredCurrency, timezone, region },
  });
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { success: "Preferences saved." };
}

export async function changePassword(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user) return { error: "Not signed in." };

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });
  if (!parsed.success) {
    return { ...issueState(parsed.error) };
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return { error: "User not found." };

  const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!valid) return { error: "Current password is incorrect." };

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  // Bumping sessionVersion invalidates every JWT issued for this account —
  // the point being that a password change kicks out anyone who had the old
  // one. That necessarily includes this session, so sign out and send the
  // user back to /login rather than leaving them on a page whose session
  // silently stopped working.
  // #375 — and stops every device's push: a browser left signed in
  // elsewhere would otherwise keep showing this member's Reminders. Each
  // device turns it on again after signing in.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    }),
    prisma.pushSubscription.deleteMany({ where: { userId: user.id } }),
  ]);
  await logSecurityEvent({ type: "PASSWORD_CHANGED", userId: user.id, email: user.email });

  await signOut({ redirectTo: "/login?passwordChanged=1" });
  return { success: "Password updated." };
}

export async function disableTotp(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user) return { error: "Not signed in." };

  const password = formData.get("password");
  if (typeof password !== "string" || password.length === 0) {
    return { error: "Enter your password to confirm." };
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return { error: "User not found." };

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return { error: "Incorrect password." };

  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: null, totpEnabled: false, totpRecoveryCodes: null },
  });
  await logSecurityEvent({ type: "TOTP_DISABLED", userId: user.id, email: user.email });

  revalidatePath("/settings");
  return { success: "Two-factor authentication disabled." };
}

const GENERIC_RESET_MESSAGE = "If that email exists, we've sent a password reset link.";

// Anyone can ask for a reset without signing in, so these rows share one
// budget across all addresses (passwordResetLog); past it, one row says
// logging is paused. A failed send is always logged: it needs a real account
// and is capped by the per-address send limit.
async function logResetRequest(email: string, address: string, detail: string, userId?: string) {
  if (!checkRateLimit("passwordResetLog", "all").allowed) return;
  consumeRateLimit("passwordResetLog", "all");
  const paused = !checkRateLimit("passwordResetLog", "all").allowed;
  await logSecurityEvent({
    type: "PASSWORD_RESET_REQUESTED",
    email: paused ? undefined : email,
    address,
    userId: paused ? undefined : userId,
    detail: paused
      ? `Too many reset requests; logging them is paused for up to ${Math.ceil(RATE_LIMITS.passwordResetLog.windowMs / 60_000)} minutes`
      : detail,
  });
}

export async function requestPasswordReset(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { ...issueState(parsed.error) };
  }

  // Capped per address rather than per email — the email is whatever the
  // caller typed. This bounds both enumeration attempts and the volume of
  // mail the app can be made to send.
  const address = clientAddress(await headers());
  const resetThrottle = consumeRateLimit("passwordReset", address);
  if (!resetThrottle.allowed) {
    // Same generic response as the success path: whether the throttle fired
    // must not reveal that the account exists. Not logged: the request that
    // used up the address's last slot already said so.
    return { success: GENERIC_RESET_MESSAGE };
  }
  if (resetThrottle.remaining === 0) {
    await logResetRequest(
      parsed.data.email,
      address,
      "Throttled: this address has used its reset requests for the hour; further ones are refused",
    );
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user) {
    await logResetRequest(parsed.data.email, address, "No account with this email; nothing sent");
    return { success: GENERIC_RESET_MESSAGE };
  }
  // The forgot-password page hides its form without SMTP, but the action can
  // still be posted (a page loaded before SMTP was removed).
  if (!(await isSmtpConfigured())) {
    await logResetRequest(user.email, address, "SMTP is not configured; nothing sent", user.id);
    return { success: GENERIC_RESET_MESSAGE };
  }

  const token = generateToken();
  await prisma.passwordResetToken.create({
    data: {
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  // env.appUrl falls back to http://localhost:3000, so this always builds.
  const resetUrl = buildConfiguredAppUrl(env.appUrl, `/reset-password/${token}`)!;
  try {
    await sendPasswordResetEmail(user.email, resetUrl);
    await logResetRequest(
      user.email,
      address,
      // #227: without APP_URL the link falls back to http://localhost:3000,
      // which is broken for anyone not on the server itself.
      isAppUrlConfigured()
        ? "Reset email handed to the SMTP server"
        : "Reset email sent, but APP_URL is not set so its link points at localhost",
      user.id,
    );
  } catch (error) {
    // The response stays identical whether or not the account exists, so the
    // failure is only visible to admins: in Settings > Security and the
    // server log.
    const reason = error instanceof Error ? error.message : "unknown error";
    console.error("[auth] password reset email failed:", reason);
    await logSecurityEvent({
      type: "PASSWORD_RESET_EMAIL_FAILED",
      userId: user.id,
      email: user.email,
      address,
      detail: reason.slice(0, 500),
    });
  }

  return { success: GENERIC_RESET_MESSAGE };
}

/**
 * Spends a one-time reset or invitation token and sets the password with it,
 * signing out every existing session. The token is claimed with a
 * conditional write first, so two requests racing on one link can't both
 * set a password: false means someone else used it, or it expired, after it
 * was checked.
 */
async function setPasswordWithToken(
  token: { id: string; userId: string },
  passwordHash: string,
  now: Date = new Date(),
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: token.id, usedAt: null, expiresAt: { gte: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return false;
    await tx.user.update({
      where: { id: token.userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    // #375 — a reset is for a lost or stolen password: stop push on every
    // device that was signed in with it. Invitations share this path; a new
    // member has no devices yet, so it deletes nothing there.
    await tx.pushSubscription.deleteMany({ where: { userId: token.userId } });
    await tx.passwordResetToken.updateMany({
      where: { userId: token.userId, usedAt: null },
      data: { usedAt: now },
    });
    return true;
  });
}

export async function resetPassword(
  token: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    return { ...issueState(parsed.error) };
  }

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (
    !resetToken ||
    !isUsableOneTimeToken({
      purpose: resetToken.purpose,
      expectedPurpose: "RESET",
      usedAt: resetToken.usedAt,
      expiresAt: resetToken.expiresAt,
    })
  ) {
    return { error: "This reset link is invalid or has expired." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  if (!(await setPasswordWithToken(resetToken, passwordHash))) {
    return { error: "This reset link is invalid or has expired." };
  }
  await logSecurityEvent({ type: "PASSWORD_RESET_COMPLETED", userId: resetToken.userId });

  // A reset ends here and sends the person to the login page to sign in
  // with the new password (ResetPasswordForm's "Continue to sign in"). It
  // doesn't sign them in itself: a reset link is something an email inbox
  // hands out, so signing in stays a separate, deliberate step, and with
  // two-factor on that step still asks for the code. Earlier sessions were
  // signed out above.
  return { success: "Password updated. You can now sign in." };
}

/**
 * Signs a newly invited member in with the password they just set and
 * redirects (signIn throws Next's redirect), or returns `fallback` for the
 * "now sign in" path
 * when the account has two-factor on or the sign-in doesn't go through.
 */
async function signInAfterPasswordSet(
  userId: string,
  password: string,
  redirectTo: string,
  fallback: string,
): Promise<ActionState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, totpEnabled: true },
  });
  if (!user || user.totpEnabled) return { success: fallback };
  try {
    await signIn("credentials", { email: user.email, password, redirectTo });
  } catch (error) {
    if (error instanceof AuthError) return { success: fallback };
    throw error;
  }
  return { success: fallback };
}

export async function acceptInvitation(
  token: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    return { ...issueState(parsed.error) };
  }

  const inviteToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (
    !inviteToken ||
    !isUsableOneTimeToken({
      purpose: inviteToken.purpose,
      expectedPurpose: "INVITE",
      usedAt: inviteToken.usedAt,
      expiresAt: inviteToken.expiresAt,
    })
  ) {
    return { error: "This invitation link is invalid or has expired." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  if (!(await setPasswordWithToken(inviteToken, passwordHash))) {
    return { error: "This invitation link is invalid or has expired." };
  }

  // #372 — land the new member on Upcoming, signed in, with a one-time
  // welcome that says what their role allows.
  return signInAfterPasswordSet(inviteToken.userId, parsed.data.password, "/calendar?welcome=1", "Password set. You can now sign in.");
}

// The caller (SignOutButton) does a full page load to /login afterwards, so
// no client-side router cache of the signed-out user's pages survives.
export async function logout(pushEndpoint?: string) {
  // #375 — drop this device's push subscription with the session, so the
  // next person on it doesn't get this member's Reminders. Best effort: it
  // must never stop the sign-out itself.
  const parsed = pushEndpointSchema.safeParse({ endpoint: pushEndpoint });
  if (parsed.success) {
    try {
      const session = await auth();
      if (session?.user?.id) {
        await prisma.pushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint, userId: session.user.id } });
      }
    } catch (error) {
      console.error("[logout] couldn't drop this device's push subscription:", error);
    }
  }
  await signOut({ redirect: false });
}
