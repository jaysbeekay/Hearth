import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readInboxDocument } from "@/lib/storage";
import { extractContractFields } from "@/lib/documents/fieldExtraction";
import { extractInvoiceFields } from "@/lib/documents/invoiceFieldExtraction";
import { extractInventoryItemFields } from "@/lib/documents/inventoryItemFieldExtraction";
import { getByokConfig } from "@/lib/ai/extract";
import { consumeLayeredRateLimit } from "@/lib/rateLimit";

// Previews auto-fill fields for a document already sitting in the inbox,
// reusing the text extracted at upload time rather than re-running OCR.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Skips OCR, but field extraction can still escalate to a cloud AI call
  // (see fieldExtraction.ts's stage 3), so it bills the same as the other
  // extraction routes and needs the same cap.
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

  const { id } = await params;
  const doc = await prisma.inboxDocument.findUnique({ where: { id } });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { target } = (await request.json()) as { target?: string };
  if (target !== "CONTRACT" && target !== "PRODUCT" && target !== "INVENTORY") {
    return NextResponse.json({ error: "Invalid target." }, { status: 400 });
  }

  const [buffer, byokUser] = await Promise.all([
    readInboxDocument(doc.storedName),
    getByokConfig(),
  ]);
  const text = doc.extractedText ?? "";
  const options = { buffer, mimeType: doc.mimeType, byokUser };

  const { fields, source } =
    target === "CONTRACT"
      ? await extractContractFields(text, options)
      : target === "PRODUCT"
        ? await extractInvoiceFields(text, options)
        : await extractInventoryItemFields(text, options);

  return NextResponse.json({ fields, source });
}
