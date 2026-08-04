import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { extractText } from "@/lib/documents/textExtraction";
import { extractHomeItemFields } from "@/lib/documents/homeItemFieldExtraction";
import { getByokConfig } from "@/lib/ai/extract";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { readValidatedUploadDetails, UploadRejectedError } from "@/lib/uploadValidation";
import { consumeRateLimit } from "@/lib/rateLimit";

// Previews auto-fill fields for a document before a home item exists yet —
// nothing is persisted here, the file is only held in memory for the
// duration of the request. The actual save happens when the item form
// is submitted (see addHomeItem in src/lib/actions/home.ts).
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isModuleEnabled("HOME"))) {
    return NextResponse.json({ error: "Property module is disabled." }, { status: 403 });
  }

  // OCR and AI extraction spawn processes or bill the household's API key, so
  // this counts every call, not just failures.
  const extractionThrottle = consumeRateLimit("documentExtraction", session.user.id);
  if (!extractionThrottle.allowed) {
    return NextResponse.json(
      { error: "Too many documents processed just now. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(extractionThrottle.retryAfterSeconds) } },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  }

  // Validates size, declared type AND leading bytes — this file is about to
  // be handed to pdftotext/pdftoppm/tesseract, so its real format matters.
  let buffer: Buffer;
  let mimeType: string;
  try {
    ({ buffer, mimeType } = await readValidatedUploadDetails(file));
  } catch (error) {
    if (error instanceof UploadRejectedError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
  const [text, byokUser] = await Promise.all([
    extractText(buffer, mimeType),
    getByokConfig(),
  ]);
  const { fields, source } = await extractHomeItemFields(text, {
    buffer,
    mimeType,
    byokUser,
  });

  return NextResponse.json({ fields, source });
}
