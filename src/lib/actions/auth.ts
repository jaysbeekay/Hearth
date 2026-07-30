"use server";

import bcrypt from "bcryptjs";
import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { AuthError, CredentialsSignin } from "next-auth";
import { revalidatePath } from "next/cache";
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
import { TIMEZONE_OPTIONS } from "@/lib/timezones";
import { POPULAR_CURRENCIES } from "@/components/CurrencySelect";
import { env, isSetupTokenRequired } from "@/lib/env";
import { generateToken, hashToken } from "@/lib/crypto";
import { isSmtpConfigured } from "@/lib/appSettings";
import { sendInvitationEmail, sendPasswordResetEmail } from "@/lib/notifications/email";

export type ActionState = {
  error?: string;
  success?: string;
  values?: Record<string, string>;
  totpRequired?: boolean;
} | null;

// Password is intentionally excluded — never echo it back to the form.
const CREATE_USER_FORM_FIELDS = ["name", "email", "role"];

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

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
    return { error: firstIssueMessage(parsed.error) };
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
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      if (error.code === "totp_required") {
        return { totpRequired: true };
      }
      if (error.code === "invalid_totp") {
        return {
          totpRequired: true,
          error: "Invalid code. Check your authenticator app or use a recovery code.",
        };
      }
    }
    if (error instanceof AuthError) {
      return { error: "Invalid email or password." };
    }
    throw error;
  }

  return null;
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
        error: firstIssueMessage(parsed.error),
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
      error: firstIssueMessage(parsed.error),
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
    await sendInvitationEmail(user.email, `${env.appUrl}/accept-invitation/${token}`);
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
    return { error: firstIssueMessage(parsed.error) };
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
  if (
    typeof timezone !== "string" ||
    !TIMEZONE_OPTIONS.includes(timezone as (typeof TIMEZONE_OPTIONS)[number])
  ) {
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
    return { error: firstIssueMessage(parsed.error) };
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
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, sessionVersion: { increment: 1 } },
  });

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

  revalidatePath("/settings");
  return { success: "Two-factor authentication disabled." };
}

const GENERIC_RESET_MESSAGE = "If that email exists, we've sent a password reset link.";

export async function requestPasswordReset(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (user) {
    const token = generateToken();
    await prisma.passwordResetToken.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    try {
      await sendPasswordResetEmail(user.email, `${env.appUrl}/reset-password/${token}`);
    } catch {
      // Swallowed: the response must stay identical whether or not the
      // account exists, and regardless of transient SMTP failures.
    }
  }

  return { success: GENERIC_RESET_MESSAGE };
}

export async function resetPassword(
  token: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (
    !resetToken ||
    resetToken.purpose !== "RESET" ||
    resetToken.usedAt ||
    resetToken.expiresAt.getTime() < Date.now()
  ) {
    return { error: "This reset link is invalid or has expired." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId: resetToken.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);

  return { success: "Password updated. You can now sign in." };
}

export async function acceptInvitation(
  token: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    return { error: firstIssueMessage(parsed.error) };
  }

  const inviteToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (
    !inviteToken ||
    inviteToken.purpose !== "INVITE" ||
    inviteToken.usedAt ||
    inviteToken.expiresAt.getTime() < Date.now()
  ) {
    return { error: "This invitation link is invalid or has expired." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: inviteToken.userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId: inviteToken.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);

  return { success: "Password set. You can now sign in." };
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
