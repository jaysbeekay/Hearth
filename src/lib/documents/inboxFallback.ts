import { prisma } from "@/lib/prisma";
import { saveInboxDocument } from "@/lib/storage";
import { extractSearchableText } from "@/lib/documents/textExtraction";
import { computeInboxIntake } from "@/lib/documents/inboxIntake";

/**
 * Last-resort save path (#203) — used when a file has already been
 * validated but couldn't be attached to the record it was meant for (a
 * storage write failure, not a rejection; rejections are still blocked
 * upfront by describeUploadRejection before the record is even created).
 * Never silently drops the upload: it lands in the Household Inbox, same
 * as any other unfiled document, instead of vanishing with no trace.
 *
 * Returns null only if the inbox save itself also fails — genuinely
 * nothing more this app can do at that point (e.g. disk full).
 */
export async function saveFileToInboxFallback(
  file: File,
  uploadedById: string | null,
): Promise<{ id: string } | null> {
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { storedName, size, sha256, mimeType } = await saveInboxDocument(file);
    const extractedText = await extractSearchableText(buffer, file.type);
    const { status, guessedType } = await computeInboxIntake({ extractedText, sha256 });
    const doc = await prisma.inboxDocument.create({
      data: {
        filename: file.name.slice(0, 255),
        storedName,
        mimeType,
        size,
        extractedText,
        uploadedById,
        sha256,
        status,
        guessedType,
      },
    });
    return { id: doc.id };
  } catch (error) {
    console.error("[inbox-fallback] failed to save file to inbox:", error);
    return null;
  }
}
