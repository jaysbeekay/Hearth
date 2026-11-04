import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { DOCUMENT_KIND_MODULE } from "@/lib/documents/kinds";
import { findDocumentAnyKind, isDocumentOwnerInTrash, type DocumentRecord } from "@/lib/commands/documents";

// #374 — share links: a URL that serves one Document without a session, for
// a browser that can't hand the file itself to the share sheet. The token is
// 32 random bytes and only its SHA-256 is stored, as for password reset
// tokens. A link works for SHARE_LINK_HOURS, until it's revoked, and only
// while its Document could be served to a signed-in member.

export const SHARE_LINK_HOURS = 24;

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The Document behind `id` if a member could open it right now: not in
 * Trash, its record not in Trash, and its kind's module on. Null otherwise,
 * so each case reads as not found. The file route and share links share it.
 */
export async function findServableDocument(id: string): Promise<DocumentRecord | null> {
  const doc = await findDocumentAnyKind(id);
  if (!doc || doc.deletedAt) return null;
  const moduleKey = DOCUMENT_KIND_MODULE[doc.kind];
  if (moduleKey && !(await isModuleEnabled(moduleKey))) return null;
  if (await isDocumentOwnerInTrash(doc)) return null;
  return doc;
}

/** Creates a link to a servable Document; the raw token is only ever returned here. */
export async function createShareLink(documentId: string, userId: string, now: Date = new Date()) {
  const doc = await findServableDocument(documentId);
  if (!doc) return null;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SHARE_LINK_HOURS * 60 * 60 * 1000);
  const link = await prisma.documentShareLink.create({
    data: { tokenHash: hashShareToken(token), documentId: doc.id, createdById: userId, expiresAt },
  });
  return { id: link.id, token, expiresAt, filename: doc.filename };
}

/**
 * The Document a share token opens and its bytes, or null when the token is
 * unknown, expired or revoked, its Document can't be served, or its file
 * can't be read: all the same not found.
 *
 * The link and Document are checked again after the file is read, and the
 * open is counted in the same conditional write, so a revoke or a move to
 * Trash that lands while the file is being read stops the download. Only a
 * response already on its way when the revoke lands still completes.
 */
export async function openShareLink(
  token: string,
  read: (doc: DocumentRecord) => Promise<Buffer>,
  now: Date = new Date(),
): Promise<{ doc: DocumentRecord; buffer: Buffer } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const link = await prisma.documentShareLink.findUnique({ where: { tokenHash: hashShareToken(token) } });
  if (!link || link.revokedAt || link.expiresAt <= now) return null;
  const doc = await findServableDocument(link.documentId);
  if (!doc) return null;

  let buffer: Buffer;
  try {
    buffer = await read(doc);
  } catch {
    return null;
  }

  if (!(await findServableDocument(doc.id))) return null;
  const { count } = await prisma.documentShareLink.updateMany({
    where: { id: link.id, revokedAt: null, expiresAt: { gt: now } },
    data: { openCount: { increment: 1 }, lastOpenedAt: now },
  });
  if (count !== 1) return null;
  // Trashing a Document doesn't revoke its links, so the write above can't
  // see it. Checking once more after the open is counted means a Trash that
  // lands before this point is never served; one that lands after it came
  // after the open. The open that didn't happen is taken back off the count.
  if (!(await findServableDocument(doc.id))) {
    await prisma.documentShareLink.updateMany({
      where: { id: link.id, openCount: { gt: 0 } },
      data: { openCount: { decrement: 1 } },
    });
    return null;
  }
  return { doc, buffer };
}

/** Links that still work (or would, if their Document is live), newest first. */
export async function listActiveShareLinks(now: Date = new Date()) {
  const links = await prisma.documentShareLink.findMany({
    where: { revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true } } },
  });
  const docs = await Promise.all(links.map((link) => findDocumentAnyKind(link.documentId)));
  return links.map((link, i) => ({
    id: link.id,
    filename: docs[i]?.filename ?? "Deleted document",
    createdByName: link.createdBy?.name ?? null,
    createdById: link.createdById,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    openCount: link.openCount,
  }));
}

/** Clears links that have expired or were revoked over a day ago; run with Trash's daily purge. */
export async function purgeStaleShareLinks(now: Date = new Date()) {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  await prisma.documentShareLink.deleteMany({
    where: { OR: [{ expiresAt: { lte: dayAgo } }, { revokedAt: { lte: dayAgo } }] },
  });
}
