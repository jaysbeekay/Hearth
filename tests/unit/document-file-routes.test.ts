import { rm } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { addDocumentCommand, deleteDocumentCommand } from "@/lib/commands/documents";
import { saveInboxDocument } from "@/lib/storage";
import { auth } from "@/lib/auth";
import { GET as getDocumentFile, HEAD as headDocumentFile } from "@/app/api/documents/[id]/route";
import { GET as getInboxFile, HEAD as headInboxFile } from "@/app/api/documents/inbox/[id]/route";

// #587: the two file routes the PDF preview frames with ?inline=1. Only a
// PDF is served inline, and HEAD (the preview's check before it frames the
// file) answers from the database row without reading the file.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1", role: "MEMBER" } })) }));

const db = setupTestDb();

let actorId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  actorId = (await createTestUser()).id;
});

function req(url: string, method = "GET") {
  return new NextRequest(`http://localhost${url}`, { method });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function pdf(name: string) {
  return new File(["%PDF-1.4\n% test document\n"], name, { type: "application/pdf" });
}

function png(name: string) {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], name, { type: "image/png" });
}

async function contractPdf(name = "lease.pdf") {
  const contract = await db.prisma.contract.create({
    data: { title: "Lease", category: "OTHER", provider: "Agent", createdById: actorId },
  });
  const doc = await addDocumentCommand("CONTRACT", contract.id, { file: pdf(name) });
  return { contractId: contract.id, doc };
}

async function inboxFile(file: File) {
  const stored = await saveInboxDocument(file);
  const row = await db.prisma.inboxDocument.create({
    data: {
      filename: file.name,
      storedName: stored.storedName,
      mimeType: file.type,
      size: stored.size,
      uploadedById: actorId,
    },
  });
  return { row, filePath: path.join(db.uploadsDir, "inbox", stored.storedName) };
}

describe("/api/documents/[id]", () => {
  it("HEAD ?inline=1 gives the inline headers without reading the file", async () => {
    const { contractId, doc } = await contractPdf("John’s lease.pdf");
    // With the file gone, a GET would fail; HEAD never reads it.
    await rm(path.join(db.uploadsDir, contractId, doc.storedName));

    const res = await headDocumentFile(req(`/api/documents/${doc.id}?inline=1`, "HEAD"), params(doc.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe(
      "inline; filename=\"John_s lease.pdf\"; filename*=UTF-8''John%E2%80%99s%20lease.pdf",
    );
    expect(res.headers.get("Content-Length")).toBe(String(doc.size));
    expect(res.body).toBeNull();

    await expect(getDocumentFile(req(`/api/documents/${doc.id}?inline=1`), params(doc.id))).rejects.toThrow();
  });

  it("HEAD answers 401 signed out and 404 for a trashed or unknown Document, like GET", async () => {
    const { doc } = await contractPdf();

    vi.mocked(auth).mockResolvedValueOnce(null as never);
    expect((await headDocumentFile(req(`/api/documents/${doc.id}`, "HEAD"), params(doc.id))).status).toBe(401);

    expect((await headDocumentFile(req("/api/documents/nope", "HEAD"), params("nope"))).status).toBe(404);

    await deleteDocumentCommand("CONTRACT", doc.id);
    expect((await headDocumentFile(req(`/api/documents/${doc.id}?inline=1`, "HEAD"), params(doc.id))).status).toBe(404);
    expect((await getDocumentFile(req(`/api/documents/${doc.id}?inline=1`), params(doc.id))).status).toBe(404);
  });
});

describe("/api/documents/inbox/[id]", () => {
  it("serves a PDF inline only with ?inline=1", async () => {
    const { row } = await inboxFile(pdf("scan.pdf"));

    const inline = await getInboxFile(req(`/api/documents/inbox/${row.id}?inline=1`), params(row.id));
    expect(inline.status).toBe(200);
    expect(inline.headers.get("Content-Disposition")).toMatch(/^inline; filename="scan.pdf"/);
    expect(await inline.text()).toContain("%PDF-1.4");

    const plain = await getInboxFile(req(`/api/documents/inbox/${row.id}`), params(row.id));
    expect(plain.headers.get("Content-Disposition")).toMatch(/^attachment; filename="scan.pdf"/);
  });

  it("keeps any other type an attachment, ?inline=1 or not", async () => {
    const { row } = await inboxFile(png("photo.png"));
    const res = await getInboxFile(req(`/api/documents/inbox/${row.id}?inline=1`), params(row.id));
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
  });

  it("HEAD answers from the row without reading the file", async () => {
    const { row, filePath } = await inboxFile(pdf("日本.pdf"));
    await rm(filePath);

    const res = await headInboxFile(req(`/api/documents/inbox/${row.id}?inline=1`, "HEAD"), params(row.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe(
      "inline; filename=\"__.pdf\"; filename*=UTF-8''%E6%97%A5%E6%9C%AC.pdf",
    );
    expect(res.headers.get("Content-Length")).toBe(String(row.size));
    expect(res.body).toBeNull();
  });

  it("HEAD answers 401 signed out and 404 for an unknown file", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    expect((await headInboxFile(req("/api/documents/inbox/x", "HEAD"), params("x"))).status).toBe(401);
    expect((await headInboxFile(req("/api/documents/inbox/x", "HEAD"), params("x"))).status).toBe(404);
  });
});
