import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { createShareLink, openShareLink, listActiveShareLinks, purgeStaleShareLinks, hashShareToken } from "@/lib/documents/shareLinks";
import { createDocumentShareLink, revokeDocumentShareLink } from "@/lib/actions/documentShare";
import { auth } from "@/lib/auth";
import { isPublicPath } from "@/lib/auth.config";

// #374 — share links against a real migrated database.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const db = setupTestDb();
let userId: string;
let documentId: string;
let contractId: string;

function signInAs(user: { id: string; email: string }, role: "ADMIN" | "MEMBER" | "READONLY") {
  vi.mocked(auth).mockResolvedValue({ user: { ...user, role }, expires: "" } as never);
}

beforeEach(async () => {
  const user = await createTestUser();
  userId = user.id;
  const contract = await db.prisma.contract.create({
    data: { title: "Car insurance", category: "CAR_INSURANCE", provider: "Insurer", createdById: userId },
  });
  contractId = contract.id;
  const doc = await db.prisma.document.create({
    data: { contractId, filename: "policy.pdf", storedName: "stored.pdf", mimeType: "application/pdf", size: 10 },
  });
  documentId = doc.id;
});

const HOUR = 60 * 60 * 1000;
const bytes = async () => Buffer.from("file");

describe("share links", () => {
  it("open the Document for 24 hours, and store only a hash of the token", async () => {
    const now = new Date("2026-11-03T10:00:00Z");
    const link = await createShareLink(documentId, userId, now);
    expect(link?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await db.prisma.documentShareLink.findFirstOrThrow();
    expect(row.tokenHash).toBe(hashShareToken(link!.token));
    expect(row.tokenHash).not.toContain(link!.token);

    expect((await openShareLink(link!.token, bytes, new Date(now.getTime() + 23 * HOUR)))?.doc.id).toBe(documentId);
    expect(await openShareLink(link!.token, bytes, new Date(now.getTime() + 24 * HOUR))).toBeNull();
    const opened = await db.prisma.documentShareLink.findFirstOrThrow();
    expect(opened.openCount).toBe(1);
  });

  it("stop working once the Document or its record is in Trash", async () => {
    const link = await createShareLink(documentId, userId);
    await db.prisma.contract.update({ where: { id: contractId }, data: { deletedAt: new Date() } });
    expect(await openShareLink(link!.token, bytes)).toBeNull();
    await db.prisma.contract.update({ where: { id: contractId }, data: { deletedAt: null } });
    await db.prisma.document.update({ where: { id: documentId }, data: { deletedAt: new Date() } });
    expect(await openShareLink(link!.token, bytes)).toBeNull();
  });

  it("stop a download when revoked or trashed while the file is being read", async () => {
    const link = await createShareLink(documentId, userId);
    const row = await db.prisma.documentShareLink.findFirstOrThrow();
    const revokeMidRead = async () => {
      await db.prisma.documentShareLink.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
      return Buffer.from("file");
    };
    expect(await openShareLink(link!.token, revokeMidRead)).toBeNull();

    const second = await createShareLink(documentId, userId);
    const trashMidRead = async () => {
      await db.prisma.document.update({ where: { id: documentId }, data: { deletedAt: new Date() } });
      return Buffer.from("file");
    };
    expect(await openShareLink(second!.token, trashMidRead)).toBeNull();
    expect(await db.prisma.documentShareLink.aggregate({ _sum: { openCount: true } })).toEqual({ _sum: { openCount: 0 } });
  });

  it("read as not found, and don't count an open, when the file can't be read", async () => {
    const link = await createShareLink(documentId, userId);
    const missing = async (): Promise<Buffer> => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };
    expect(await openShareLink(link!.token, missing)).toBeNull();
    expect((await db.prisma.documentShareLink.findFirstOrThrow()).openCount).toBe(0);
  });

  it("refuse an unknown or malformed token", async () => {
    expect(await openShareLink("nope", bytes)).toBeNull();
    expect(await openShareLink("a".repeat(43), bytes)).toBeNull();
  });

  it("can't be made for a Document in Trash", async () => {
    await db.prisma.document.update({ where: { id: documentId }, data: { deletedAt: new Date() } });
    expect(await createShareLink(documentId, userId)).toBeNull();
  });

  it("are cleared a day after they expire", async () => {
    const now = new Date("2026-11-03T10:00:00Z");
    await createShareLink(documentId, userId, now);
    await purgeStaleShareLinks(new Date(now.getTime() + 47 * HOUR));
    expect(await db.prisma.documentShareLink.count()).toBe(1);
    await purgeStaleShareLinks(new Date(now.getTime() + 48 * HOUR));
    expect(await db.prisma.documentShareLink.count()).toBe(0);
  });

  it("are served from a public path", () => {
    expect(isPublicPath("/api/share/abc")).toBe(true);
    expect(isPublicPath("/api/shared")).toBe(false);
  });
});

describe("share link actions", () => {
  it("logs the link, and only its creator or an admin can revoke it", async () => {
    const user = await db.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    signInAs(user, "MEMBER");
    const result = await createDocumentShareLink(documentId);
    if ("error" in result) throw new Error(result.error);
    expect(result.path).toMatch(/^\/api\/share\/[A-Za-z0-9_-]{43}$/);
    expect(await db.prisma.securityEventLog.count({ where: { type: "DOCUMENT_SHARE_LINK_CREATED" } })).toBe(1);

    const other = await createTestUser({ email: "other@example.com" });
    signInAs(other, "MEMBER");
    expect((await revokeDocumentShareLink(result.id)).error).toMatch(/Only whoever shared it/);

    signInAs(other, "ADMIN");
    expect(await revokeDocumentShareLink(result.id)).toEqual({ success: "Link revoked." });
    expect(await openShareLink(result.path.split("/").pop()!, bytes)).toBeNull();
    expect(await listActiveShareLinks()).toEqual([]);
    expect(await db.prisma.securityEventLog.count({ where: { type: "DOCUMENT_SHARE_LINK_REVOKED" } })).toBe(1);
  });

  it("refuses read-only members", async () => {
    const user = await db.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    signInAs(user, "READONLY");
    await expect(createDocumentShareLink(documentId)).rejects.toThrow("read-only");
  });
});
