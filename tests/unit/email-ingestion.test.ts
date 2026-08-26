import { describe, expect, it } from "vitest";
import { getIngestibleAttachments } from "@/lib/emailIngestion/parser";

describe("email ingestion attachment parsing", () => {
  it("keeps valid binary attachments and supplies a fallback filename", () => {
    const attachments = getIngestibleAttachments({
      attachments: [
        { filename: "receipt.pdf", contentType: "application/pdf", content: Buffer.from("pdf") },
        { filename: undefined, contentType: "text/plain", content: Buffer.from("body") },
        { filename: "empty.bin", contentType: "application/octet-stream", content: Buffer.alloc(0) },
      ],
    } as never);
    expect(attachments.map(({ filename, contentType }) => ({ filename, contentType }))).toEqual([
      { filename: "receipt.pdf", contentType: "application/pdf" },
      { filename: "attachment", contentType: "text/plain" },
    ]);
  });

  it("returns no attachments for malformed or empty attachment entries", () => {
    expect(getIngestibleAttachments({ attachments: [{ content: "not-a-buffer", contentType: "text/plain" }] } as never)).toEqual([]);
  });
});
