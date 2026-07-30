import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { extractText } from "@/lib/documents/textExtraction";
import { extractContractFields } from "@/lib/documents/fieldExtraction";
import { getByokConfig } from "@/lib/ai/extract";
import { readValidatedUpload, UploadRejectedError } from "@/lib/uploadValidation";

// Previews auto-fill fields for a document before a contract exists yet —
// nothing is persisted here, the file is only held in memory for the
// duration of the request. The actual save happens when the contract form
// is submitted (see createContract in src/lib/actions/contracts.ts).
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  }

  // Validates size, declared type AND leading bytes — this file is about to
  // be handed to pdftotext/pdftoppm/tesseract, so its real format matters.
  let buffer: Buffer;
  try {
    buffer = await readValidatedUpload(file);
  } catch (error) {
    if (error instanceof UploadRejectedError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
  const [text, byokUser] = await Promise.all([
    extractText(buffer, file.type),
    getByokConfig(),
  ]);
  const { fields, source } = await extractContractFields(text, {
    buffer,
    mimeType: file.type,
    byokUser,
  });

  return NextResponse.json({ fields, source });
}
