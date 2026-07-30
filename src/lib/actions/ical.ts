"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateToken, hashToken } from "@/lib/crypto";
import type { ActionState } from "@/lib/actions/auth";

// Only the hash is stored, so the feed URL can be shown exactly once — at
// generation. Revisiting Settings afterwards shows that a feed is active and
// offers to replace it, but can't reproduce the URL. That's the trade for not
// keeping a working bearer token sitting in the database (#163).
export type IcalActionState = (NonNullable<ActionState> & { token?: string }) | null;

export async function generateIcalToken(): Promise<IcalActionState> {
  const session = await auth();
  if (!session?.user) return { error: "Not signed in." };

  const token = generateToken();
  await prisma.user.update({
    where: { id: session.user.id },
    data: { icalTokenHash: hashToken(token) },
  });

  revalidatePath("/settings");
  return {
    success: "Calendar feed created. Copy the URL now — it won't be shown again.",
    token,
  };
}

export async function revokeIcalToken(): Promise<IcalActionState> {
  const session = await auth();
  if (!session?.user) return { error: "Not signed in." };

  await prisma.user.update({
    where: { id: session.user.id },
    data: { icalTokenHash: null },
  });

  revalidatePath("/settings");
  return { success: "Calendar feed revoked. Any calendar subscribed to it will stop updating." };
}
