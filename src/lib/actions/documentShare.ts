"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logSecurityEvent } from "@/lib/securityEventLog";
import { createShareLink, SHARE_LINK_HOURS } from "@/lib/documents/shareLinks";

// #374 — share links for a Document. Creating one puts a household file on a
// public URL for a day, so read-only members can't, and every link is
// recorded in the Security log. Whoever created a link, or an admin, can
// revoke it.

export type ShareLinkResult = { error: string } | { id: string; path: string; expiresAt: string; hours: number };

async function requireWriter() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (session.user.role === "READONLY") throw new Error("Your account has read-only access.");
  return session.user;
}

export async function createDocumentShareLink(documentId: string): Promise<ShareLinkResult> {
  const user = await requireWriter();
  if (typeof documentId !== "string" || documentId === "") return { error: "Document not found." };
  const link = await createShareLink(documentId, user.id);
  if (!link) return { error: "Document not found." };
  await logSecurityEvent({
    type: "DOCUMENT_SHARE_LINK_CREATED",
    userId: user.id,
    email: user.email ?? undefined,
    detail: `${link.filename} (link ${link.id}, ${SHARE_LINK_HOURS} h)`,
  });
  revalidatePath("/settings/security");
  return { id: link.id, path: `/api/share/${link.token}`, expiresAt: link.expiresAt.toISOString(), hours: SHARE_LINK_HOURS };
}

export async function revokeDocumentShareLink(linkId: string): Promise<{ error?: string; success?: string }> {
  const user = await requireWriter();
  const link = typeof linkId === "string" ? await prisma.documentShareLink.findUnique({ where: { id: linkId } }) : null;
  if (!link) return { error: "Link not found." };
  if (link.createdById !== user.id && user.role !== "ADMIN") {
    return { error: "Only whoever shared it, or an admin, can revoke this link." };
  }
  if (!link.revokedAt) {
    await prisma.documentShareLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
    await logSecurityEvent({
      type: "DOCUMENT_SHARE_LINK_REVOKED",
      userId: user.id,
      email: user.email ?? undefined,
      detail: `link ${link.id}`,
    });
  }
  revalidatePath("/settings/security");
  return { success: "Link revoked." };
}
