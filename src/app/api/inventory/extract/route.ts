import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { extractText } from "@/lib/documents/textExtraction";
import { extractInventoryItemFields } from "@/lib/documents/inventoryItemFieldExtraction";
import { getByokConfig } from "@/lib/ai/extract";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { readValidatedUpload, UploadRejectedError } from "@/lib/uploadValidation";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isModuleEnabled("INVENTORY"))) {
    return NextResponse.json({ error: "Inventory module is disabled." }, { status: 403 });
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
  const { fields, source } = await extractInventoryItemFields(text, {
    buffer,
    mimeType: file.type,
    byokUser,
  });

  return NextResponse.json({ fields, source });
}
