import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isBarcodeLookupConfigured } from "@/lib/appSettings";
import { isValidBarcode, lookupBarcode } from "@/lib/barcodeLookup";

// Looks up a scanned barcode against an online product database to
// pre-fill fields when adding a new product. Nothing is persisted here —
// the barcode itself is saved when the product form is submitted.
export async function GET(request: NextRequest) {
  if (!(await isBarcodeLookupConfigured())) {
    return NextResponse.json(
      { error: "Set BARCODE_LOOKUP_ENABLED to enable this endpoint" },
      { status: 404 },
    );
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  if (!isValidBarcode(code)) {
    return NextResponse.json({ error: "Invalid barcode." }, { status: 400 });
  }

  const result = await lookupBarcode(code);
  if (!result?.ok) {
    return NextResponse.json({ fields: {}, found: false, reason: result?.reason ?? "not_found" });
  }
  return NextResponse.json({ fields: result.info, found: true });
}
