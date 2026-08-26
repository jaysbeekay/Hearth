import type { ParsedMail } from "mailparser";

export type IngestibleAttachment = {
  filename: string;
  contentType: string;
  content: Buffer;
};

export function getIngestibleAttachments(parsed: ParsedMail): IngestibleAttachment[] {
  return parsed.attachments.flatMap((attachment) => {
    if (!(attachment.content instanceof Buffer) || attachment.content.length === 0) return [];
    return [{
      filename: attachment.filename || "attachment",
      contentType: attachment.contentType,
      content: attachment.content,
    }];
  });
}
