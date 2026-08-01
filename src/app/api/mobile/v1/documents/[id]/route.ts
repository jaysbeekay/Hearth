import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  deleteDocument as deleteContractDocument,
  deleteProductDocument,
  deleteVehicleItemDocument,
} from "@/lib/storage";
import {
  mapDocument,
  mobileError,
  requireMobileUser,
} from "@/app/api/mobile/v1/_lib/mobileApi";

async function findDocument(id: string) {
  const contractDoc = await prisma.document.findUnique({ where: { id } });
  if (contractDoc) {
    return {
      ownerType: "contract" as const,
      ownerId: contractDoc.contractId,
      row: contractDoc,
      remove: async () => {
        await prisma.document.delete({ where: { id } });
        await deleteContractDocument(
          contractDoc.contractId,
          contractDoc.storedName,
        );
      },
    };
  }

  const productDoc = await prisma.productDocument.findUnique({ where: { id } });
  if (productDoc) {
    return {
      ownerType: "product" as const,
      ownerId: productDoc.productId,
      row: productDoc,
      remove: async () => {
        await prisma.productDocument.delete({ where: { id } });
        await deleteProductDocument(
          productDoc.productId,
          productDoc.storedName,
        );
      },
    };
  }

  const vehicleItemDoc = await prisma.vehicleItemDocument.findUnique({
    where: { id },
  });
  if (vehicleItemDoc) {
    return {
      ownerType: "vehicleItem" as const,
      ownerId: vehicleItemDoc.vehicleItemId,
      row: vehicleItemDoc,
      remove: async () => {
        await prisma.vehicleItemDocument.delete({ where: { id } });
        await deleteVehicleItemDocument(
          vehicleItemDoc.vehicleItemId,
          vehicleItemDoc.storedName,
        );
      },
    };
  }

  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireMobileUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const found = await findDocument(id);
  return found
    ? NextResponse.json(mapDocument(found.ownerType, found.row, found.ownerId))
    : mobileError("Not found.", 404);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireMobileUser({ write: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const found = await findDocument(id);
  if (found) await found.remove();
  return new NextResponse(null, { status: 204 });
}
