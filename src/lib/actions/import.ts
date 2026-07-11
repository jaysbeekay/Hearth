"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { contractSchema } from "@/lib/validation/contract";
import { productSchema } from "@/lib/validation/product";
import { formToContractInput, formToProductInput } from "@/lib/formMappers";
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  saveDocument,
  saveProductDocument,
} from "@/lib/storage";
import { ProductDocumentKind } from "@/generated/prisma/enums";

export interface ImportResult {
  success?: string;
  error?: string;
  id?: string;
  href?: string;
}

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (session.user.role === "READONLY") throw new Error("Your account has read-only access.");
  return session.user;
}

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Invalid input";
}

// Bulk-import variants of createContract/createProduct: same validation and
// document-attach logic, but return a result instead of redirect()-ing, so
// the import review queue can save many rows without navigating away.

export async function importContract(formData: FormData): Promise<ImportResult> {
  const user = await requireUser();

  const parsed = contractSchema.safeParse(formToContractInput(formData));
  if (!parsed.success) return { error: firstIssueMessage(parsed.error) };

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (15MB max)." };
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return { error: "Unsupported file type. Use PDF, Word, or image files." };
    }
  }

  const contract = await prisma.contract.create({
    data: { ...parsed.data, createdById: user.id },
  });

  if (file instanceof File && file.size > 0) {
    const { storedName, size } = await saveDocument(contract.id, file);
    await prisma.document.create({
      data: {
        contractId: contract.id,
        filename: file.name.slice(0, 255),
        storedName,
        mimeType: file.type,
        size,
      },
    });
  }

  revalidatePath("/contracts");
  revalidatePath("/dashboard");
  return { success: "Saved", id: contract.id, href: `/contracts/${contract.id}` };
}

export async function importProduct(formData: FormData): Promise<ImportResult> {
  const user = await requireUser();

  const parsed = productSchema.safeParse(formToProductInput(formData));
  if (!parsed.success) return { error: firstIssueMessage(parsed.error) };

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (15MB max)." };
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return { error: "Unsupported file type. Use PDF, Word, or image files." };
    }
  }

  const product = await prisma.product.create({
    data: { ...parsed.data, createdById: user.id },
  });

  if (file instanceof File && file.size > 0) {
    const { storedName, size } = await saveProductDocument(product.id, file);
    await prisma.productDocument.create({
      data: {
        productId: product.id,
        filename: file.name.slice(0, 255),
        storedName,
        mimeType: file.type,
        size,
        kind: ProductDocumentKind.INVOICE,
      },
    });
  }

  revalidatePath("/products");
  revalidatePath("/dashboard");
  return { success: "Saved", id: product.id, href: `/products/${product.id}` };
}
