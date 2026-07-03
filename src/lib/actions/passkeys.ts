"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import type { ActionState } from "@/lib/actions/auth";

export async function deletePasskeyCredential(credentialId: string): Promise<ActionState> {
  const session = await auth();
  if (!session?.user) return { error: "Not signed in." };

  const credential = await prisma.passkeyCredential.findUnique({
    where: { credentialId },
  });
  if (!credential) return { error: "Passkey not found." };
  if (credential.userId !== session.user.id) return { error: "Not your passkey." };

  await prisma.passkeyCredential.delete({ where: { credentialId } });
  revalidatePath("/settings/passkeys");
  return { success: "Passkey removed." };
}

export async function renamePasskeyCredential(
  credentialId: string,
  nickname: string,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user) return { error: "Not signed in." };

  const trimmed = nickname.trim().slice(0, 100);

  const credential = await prisma.passkeyCredential.findUnique({
    where: { credentialId },
  });
  if (!credential) return { error: "Passkey not found." };
  if (credential.userId !== session.user.id) return { error: "Not your passkey." };

  await prisma.passkeyCredential.update({
    where: { credentialId },
    data: { nickname: trimmed || null },
  });
  revalidatePath("/settings/passkeys");
  return { success: "Passkey renamed." };
}
