import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/storage";
import { extractText } from "@/lib/documents/textExtraction";
import { extractVehicleItemFields } from "@/lib/documents/vehicleItemFieldExtraction";
import { getByokUser } from "@/lib/ai/extract";
import { isModuleEnabled } from "@/lib/modules/enablement";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isModuleEnabled("VEHICLES"))) {
    return NextResponse.json({ error: "Vehicles module is disabled." }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File is too large (15MB max)." }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Unsupported file type." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const [text, byokUser] = await Promise.all([
    extractText(buffer, file.type),
    getByokUser(session.user.id),
  ]);
  const { fields, source } = await extractVehicleItemFields(text, {
    buffer,
    mimeType: file.type,
    byokUser,
  });

  return NextResponse.json({ fields, source });
}
