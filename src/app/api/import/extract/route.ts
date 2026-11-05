import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getByokConfig } from "@/lib/ai/extract";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { extractForImport } from "@/lib/documents/importExtraction";
import { readValidatedUploadDetails, UploadRejectedError } from "@/lib/uploadValidation";
import { consumeLayeredRateLimit } from "@/lib/rateLimit";
import { readOnlyApiResponse } from "@/lib/readOnly";

// #358 — the Upload page's single scan of a file: guesses its type and
// returns fields for every type it could be filed as (extractForImport).
// Nothing is persisted; the file is only held for the request, as for the
// per-type extract routes, with the same auth, read-only and rate limits.
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const readOnly = readOnlyApiResponse(session);
  if (readOnly) return readOnly;

  const extractionThrottle = consumeLayeredRateLimit(
    ["documentExtraction", "documentExtractionDaily"],
    session.user.id,
  );
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

  const [byokUser, inventoryEnabled] = await Promise.all([getByokConfig(), isModuleEnabled("INVENTORY")]);
  return NextResponse.json(await extractForImport(buffer, mimeType, { inventoryEnabled, byokUser }));
}
