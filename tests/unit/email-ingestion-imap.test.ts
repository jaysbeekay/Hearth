import { describe, expect, it, vi } from "vitest";

const { prisma, config } = vi.hoisted(() => ({
  prisma: {
    processedEmailMessage: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    inboxDocument: { create: vi.fn() },
  },
  config: {
    host: "fake-imap",
    port: 993,
    secure: true,
    user: "fixture@example.com",
    pass: "fixture-password",
    mailbox: "INBOX",
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/appSettings", () => ({
  isEmailIngestionConfigured: vi.fn().mockResolvedValue(true),
  getEmailIngestConfig: vi.fn().mockResolvedValue(config),
}));
vi.mock("@/lib/storage", () => ({ saveInboxDocument: vi.fn().mockResolvedValue({ storedName: "stored.pdf", size: 3, sha256: "hash" }) }));
vi.mock("@/lib/documents/textExtraction", () => ({ extractSearchableText: vi.fn().mockResolvedValue("receipt text") }));
vi.mock("@/lib/documents/inboxIntake", () => ({ computeInboxIntake: vi.fn().mockResolvedValue({ status: "PENDING", guessedType: "INVOICE" }) }));

import { runEmailIngestion, type EmailIngestionClient } from "@/lib/emailIngestion/scheduler";

function fakeClient(messages: Buffer[]): EmailIngestionClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
    search: vi.fn().mockResolvedValue(messages.map((_, i) => i + 1)),
    download: vi.fn().mockImplementation(async (uid: number) => ({ content: messages[uid - 1] })),
    messageFlagsAdd: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  };
}

describe("email ingestion IMAP seam", () => {
  it("files a real MIME attachment and skips an unparseable message", async () => {
    const validMessage = Buffer.from(
      "From: sender@example.com\r\nMessage-ID: <fixture-1>\r\nContent-Type: multipart/mixed; boundary=abc\r\n\r\n--abc\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=receipt.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\ndGRl\r\n--abc--\r\n",
    );
    const client = fakeClient([validMessage, Buffer.from("not an RFC822 message")]);

    const result = await runEmailIngestion(() => client);

    expect(result.checked).toBe(2);
    expect(result.ingested).toBe(1);
    expect(result.skipped).toBe(1);
    expect(client.messageFlagsAdd).toHaveBeenCalledTimes(2);
    expect(prisma.inboxDocument.create).toHaveBeenCalledTimes(1);
    expect(prisma.processedEmailMessage.create).toHaveBeenCalledTimes(2);
  });
});
