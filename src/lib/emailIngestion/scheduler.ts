import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { prisma } from "@/lib/prisma";
import { isEmailIngestionConfigured, getEmailIngestConfig } from "@/lib/appSettings";
import { saveInboxDocument } from "@/lib/storage";
import { UploadRejectedError } from "@/lib/uploadValidation";
import { extractSearchableText } from "@/lib/documents/textExtraction";
import { computeInboxIntake } from "@/lib/documents/inboxIntake";

// Bounds one poll's cost: a mailbox flooded with mail (or mail-bombed on
// purpose) can only ever cost one connection and this many attachment
// extractions per cycle — the rest wait for the next tick (#155's rate-
// bounding precedent, applied here since this endpoint has no per-caller
// identity to throttle against).
const MAX_MESSAGES_PER_RUN = 20;

export interface EmailIngestionResult {
  checked: number;
  ingested: number;
  skipped: number;
}

async function alreadyProcessed(messageId: string): Promise<boolean> {
  const row = await prisma.processedEmailMessage.findUnique({ where: { messageId } });
  return row != null;
}

export async function runEmailIngestion(): Promise<EmailIngestionResult> {
  if (!(await isEmailIngestionConfigured())) {
    return { checked: 0, ingested: 0, skipped: 0 };
  }

  const config = await getEmailIngestConfig();
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  let checked = 0;
  let ingested = 0;
  let skipped = 0;

  await client.connect();
  try {
    const lock = await client.getMailboxLock(config.mailbox);
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      const batch = (uids || []).slice(0, MAX_MESSAGES_PER_RUN);

      for (const uid of batch) {
        checked++;
        try {
          const { content } = await client.download(uid, undefined, { uid: true });
          const parsed = await simpleParser(content);

          const messageId = parsed.messageId ?? `no-message-id-${uid}-${config.mailbox}`;
          if (await alreadyProcessed(messageId)) {
            await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
            continue;
          }

          const fromAddress = parsed.from?.value?.[0]?.address ?? null;
          let ingestedAny = false;

          for (const attachment of parsed.attachments) {
            if (!(attachment.content instanceof Buffer) || attachment.content.length === 0) {
              continue;
            }
            const file = new File(
              [new Uint8Array(attachment.content)],
              attachment.filename || "attachment",
              { type: attachment.contentType },
            );

            try {
              const { storedName, size, sha256 } = await saveInboxDocument(file);
              const extractedText = await extractSearchableText(
                attachment.content,
                attachment.contentType,
              );
              const { status, guessedType } = await computeInboxIntake({ extractedText, sha256 });

              await prisma.inboxDocument.create({
                data: {
                  filename: file.name.slice(0, 255),
                  storedName,
                  mimeType: attachment.contentType,
                  size,
                  extractedText,
                  source: "EMAIL",
                  fromAddress,
                  guessedType,
                  status,
                  sha256,
                  uploadedById: null,
                },
              });
              ingested++;
              ingestedAny = true;
            } catch (error) {
              // Unsupported/unreadable attachment (content-sniff rejection,
              // corrupt file) — skip it, not the whole message (#195 mirrors
              // the resilience-over-perfection posture already used for
              // per-channel notification sending).
              if (!(error instanceof UploadRejectedError)) {
                console.error("[email-ingest] attachment save failed:", error);
              }
              skipped++;
            }
          }

          await prisma.processedEmailMessage.create({ data: { messageId } });
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
          if (!ingestedAny) skipped++;
        } catch (error) {
          console.error("[email-ingest] message processing failed:", error);
          skipped++;
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }

  return { checked, ingested, skipped };
}
