import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { extractText } from "@/lib/documents/textExtraction";
import { extractTripSegmentFields } from "@/lib/documents/tripFieldExtraction";
import { getByokConfig } from "@/lib/ai/extract";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { readValidatedUpload, UploadRejectedError } from "@/lib/uploadValidation";
import { consumeRateLimit } from "@/lib/rateLimit";

// Previews auto-fill fields for a document before a trip segment exists yet —
// nothing is persisted here, the file is only held in memory for the
// duration of the request. The actual save happens when the segment form
// is submitted (see addTripSegment in src/lib/actions/trips.ts).
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isModuleEnabled("TRAVEL"))) {
    return NextResponse.json({ error: "Travel module is disabled." }, { status: 403 });
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
  const { fields, source } = await extractTripSegmentFields(text, {
    buffer,
    mimeType: file.type,
    byokUser,
  });

  return NextResponse.json({ fields, source });
}
