"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth, signIn, signOut } from "@/lib/auth";
import {
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  setupSchema,
  updateMemberRoleSchema,
} from "@/lib/validation/auth";
import { formDataToStringValues } from "@/lib/form-state";
import { isKnownModuleKey } from "@/lib/modules/enablement";
import type { ModuleKey } from "@/lib/modules/registry";
import { DATE_FORMAT_OPTIONS } from "@/lib/utils";
import { TIMEZONE_OPTIONS } from "@/lib/userPreferences";
import { POPULAR_CURRENCIES } from "@/components/CurrencySelect";

export type ActionState = {
  error?: string;
  success?: string;
  values?: Record<string, string>;
} | null;

// Password is intentionally excluded — never echo it back to the form.
const CREATE_USER_FORM_FIELDS = ["name", "email", "role"];

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

export async function setupAdmin(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0) {
    return { error: "Setup has already been completed." };
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

  await prisma.$transaction([
    prisma.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
        role: "ADMIN",
      },
    }),
    ...(selectedModules.length > 0
      ? [
          prisma.moduleEnablement.createMany({
            data: selectedModules.map((key) => ({ key, enabled: true })),
          }),
        ]
      : []),
  ]);

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

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/dashboard",
    });
  } catch (error) {
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

  const parsed = createUserSchema.safeParse({
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

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });
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

  await prisma.user.update({ where: { id: userId }, data: { role: parsed.data.role } });
  revalidatePath("/settings/users");
  return { success: "Role updated." };
}

export async function updateNotificationPreferences(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) return;

  await prisma.user.update({
    where: { id: session.user.id },
    data: { emailReminders: formData.get("emailReminders") === "on" },
  });
  revalidatePath("/settings");
}

export async function updateUserPreferences(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) return;

  const dateFormat = formData.get("dateFormat");
  const preferredCurrency = formData.get("preferredCurrency");
  const timezone = formData.get("timezone");

  if (
    typeof dateFormat !== "string" ||
    typeof preferredCurrency !== "string" ||
    typeof timezone !== "string" ||
    !DATE_FORMAT_OPTIONS.includes(dateFormat as (typeof DATE_FORMAT_OPTIONS)[number]) ||
    !POPULAR_CURRENCIES.includes(preferredCurrency as (typeof POPULAR_CURRENCIES)[number]) ||
    !TIMEZONE_OPTIONS.includes(timezone as (typeof TIMEZONE_OPTIONS)[number])
  ) {
    return;
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { dateFormat, preferredCurrency, timezone },
  });
  revalidatePath("/settings");
  revalidatePath("/", "layout");
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
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  return { success: "Password updated." };
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
