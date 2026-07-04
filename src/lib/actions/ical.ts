"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ActionState } from "@/lib/actions/auth";

export async function generateIcalToken(): Promise<ActionState> {
  const session = await auth();
  if (!session?.user) return { error: "Not signed in." };

  await prisma.user.update({
    where: { id: session.user.id },
    data: { icalToken: randomUUID() },
  });

  revalidatePath("/settings");
  return { success: "iCal token generated." };
}

export async function revokeIcalToken(): Promise<ActionState> {
  const session = await auth();
  if (!session?.user) return { error: "Not signed in." };

  await prisma.user.update({
    where: { id: session.user.id },
    data: { icalToken: null },
  });

  revalidatePath("/settings");
  return { success: "iCal token revoked." };
}
