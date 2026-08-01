import { NextRequest, NextResponse } from "next/server";
import { ProductDocumentKind } from "@/generated/prisma/enums";
import { extractSearchableText } from "@/lib/documents/textExtraction";
import type { MobileDocumentOwnerType } from "@/lib/mobile/dtos";
import { prisma } from "@/lib/prisma";
import {
  saveDocument,
  saveProductDocument,
  saveVehicleItemDocument,
} from "@/lib/storage";
import { UploadRejectedError } from "@/lib/uploadValidation";
import {
  mapDocument,
  mobileError,
  requireMobileUser,
} from "@/app/api/mobile/v1/_lib/mobileApi";

function parseOwnerType(value: string | null): MobileDocumentOwnerType | null {
  return value === "contract" || value === "product" || value === "vehicleItem"
    ? value
    : null;
}

function parseProductDocumentKind(
  value: FormDataEntryValue | null,
): ProductDocumentKind {
  const allowed = Object.values(ProductDocumentKind) as string[];
  return typeof value === "string" && allowed.includes(value)
    ? (value as ProductDocumentKind)
    : ProductDocumentKind.OTHER;
}

export async function GET(request: NextRequest) {
  const auth = await requireMobileUser();
  if ("response" in auth) return auth.response;

  const ownerType = parseOwnerType(
    request.nextUrl.searchParams.get("ownerType"),
  );
  const ownerId = request.nextUrl.searchParams.get("ownerId");
  if (!ownerType || !ownerId)
    return mobileError("Expected ownerType and ownerId.", 400);

  if (ownerType === "contract") {
    const rows = await prisma.document.findMany({
      where: { contractId: ownerId },
      orderBy: { uploadedAt: "desc" },
    });
    return NextResponse.json({
      items: rows.map((row) => mapDocument("contract", row, row.contractId)),
    });
  }

  if (ownerType === "product") {
    const rows = await prisma.productDocument.findMany({
      where: { productId: ownerId },
      orderBy: { uploadedAt: "desc" },
    });
    return NextResponse.json({
      items: rows.map((row) => mapDocument("product", row, row.productId)),
    });
  }

  const rows = await prisma.vehicleItemDocument.findMany({
    where: { vehicleItemId: ownerId },
    orderBy: { uploadedAt: "desc" },
  });
  return NextResponse.json({
    items: rows.map((row) =>
      mapDocument("vehicleItem", row, row.vehicleItemId),
    ),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireMobileUser({ write: true });
  if ("response" in auth) return auth.response;

  const formData = await request.formData().catch(() => null);
  if (!formData) return mobileError("Expected multipart form data.", 400);

  const ownerType = parseOwnerType(String(formData.get("ownerType") ?? ""));
  const ownerId = String(formData.get("ownerId") ?? "");
  const file = formData.get("file");
  if (!ownerType || !ownerId || !(file instanceof File) || file.size === 0) {
    return mobileError("Expected ownerType, ownerId, and file.", 400);
  }

  try {
    if (ownerType === "contract") {
      const contract = await prisma.contract.findUnique({
        where: { id: ownerId },
        select: { id: true },
      });
      if (!contract) return mobileError("Contract not found.", 404);
      const { storedName, size } = await saveDocument(ownerId, file);
      const extractedText = await extractSearchableText(
        Buffer.from(await file.arrayBuffer()),
        file.type,
      );
      const row = await prisma.document.create({
        data: {
          contractId: ownerId,
          filename: file.name.slice(0, 255),
          storedName,
          mimeType: file.type,
          size,
          extractedText,
        },
      });
      return NextResponse.json(mapDocument("contract", row, row.contractId), {
        status: 201,
      });
    }

    if (ownerType === "product") {
      const product = await prisma.product.findUnique({
        where: { id: ownerId },
        select: { id: true },
      });
      if (!product) return mobileError("Product not found.", 404);
      const kind = parseProductDocumentKind(formData.get("kind"));
      const { storedName, size } = await saveProductDocument(ownerId, file);
      const extractedText =
        kind === ProductDocumentKind.INVOICE
          ? await extractSearchableText(
              Buffer.from(await file.arrayBuffer()),
              file.type,
            )
          : null;
      const row = await prisma.productDocument.create({
        data: {
          productId: ownerId,
          filename: file.name.slice(0, 255),
          storedName,
          mimeType: file.type,
          size,
          kind,
          extractedText,
        },
      });
      return NextResponse.json(mapDocument("product", row, row.productId), {
        status: 201,
      });
    }

    const vehicleItem = await prisma.vehicleItem.findUnique({
      where: { id: ownerId },
      select: { id: true },
    });
    if (!vehicleItem) return mobileError("Vehicle item not found.", 404);
    const { storedName, size } = await saveVehicleItemDocument(ownerId, file);
    const row = await prisma.vehicleItemDocument.create({
      data: {
        vehicleItemId: ownerId,
        filename: file.name.slice(0, 255),
        storedName,
        mimeType: file.type,
        size,
      },
    });
    return NextResponse.json(
      mapDocument("vehicleItem", row, row.vehicleItemId),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof UploadRejectedError)
      return mobileError(error.message, 413);
    throw error;
  }
}
