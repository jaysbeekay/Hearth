"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { contractSchema } from "@/lib/validation/contract";
import { productSchema } from "@/lib/validation/product";
import { inventoryItemSchema } from "@/lib/validation/inventory";
import { formToContractInput, formToProductInput } from "@/lib/formMappers";
import {
  saveDocument,
  saveProductDocument,
  saveInventoryItemDocument,
  saveInboxDocument,
  readInboxDocument,
  deleteInboxDocument,
} from "@/lib/storage";
import { ProductDocumentKind } from "@/generated/prisma/enums";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { extractSearchableText } from "@/lib/documents/textExtraction";
import { describeUploadRejection } from "@/lib/uploadValidation";
import { computeInboxIntake } from "@/lib/documents/inboxIntake";
import { getDocumentVersionChain } from "@/lib/documents/documentQueries";
import { createContractCommand } from "@/lib/commands/contracts";
import { createProductCommand } from "@/lib/commands/products";
import { extractionFieldsFromForm } from "@/lib/documents/extractionConfirmation";
import { saveExtractionReviewFieldsFromForm } from "@/lib/documents/extractionReview";
import { parseDocumentCategory } from "@/lib/documents/categories";

function formToInventoryItemInput(formData: FormData) {
  return {
    label: formData.get("label"),
    category: formData.get("category") || "OTHER",
    brand: formData.get("brand"),
    purchasePrice: formData.get("purchasePrice"),
  };
}

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
    const rejection = await describeUploadRejection(file);
    if (rejection) return { error: rejection };
  }

  const contract = await createContractCommand(parsed.data, user.id, extractionFieldsFromForm(formData));
  await saveExtractionReviewFieldsFromForm("CONTRACT", contract.id, formData);

  if (file instanceof File && file.size > 0) {
    const { storedName, size, sha256, mimeType } = await saveDocument(contract.id, file);
    await prisma.document.create({
      data: {
        contractId: contract.id,
        filename: file.name.slice(0, 255),
        storedName,
        mimeType,
        size,
        sha256,
        category: parseDocumentCategory(formData.get("documentCategory")) ?? "POLICY",
      },
    });
  }

  return { success: "Saved", id: contract.id, href: `/contracts/${contract.id}` };
}

export async function importProduct(formData: FormData): Promise<ImportResult> {
  const user = await requireUser();

  const parsed = productSchema.safeParse(formToProductInput(formData));
  if (!parsed.success) return { error: firstIssueMessage(parsed.error) };

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const rejection = await describeUploadRejection(file);
    if (rejection) return { error: rejection };
  }

  const product = await createProductCommand(parsed.data, user.id, extractionFieldsFromForm(formData));
  await saveExtractionReviewFieldsFromForm("PRODUCT", product.id, formData);

  if (file instanceof File && file.size > 0) {
    const { storedName, size, sha256, mimeType } = await saveProductDocument(product.id, file);
    await prisma.productDocument.create({
      data: {
        productId: product.id,
        filename: file.name.slice(0, 255),
        storedName,
        mimeType,
        size,
        kind: ProductDocumentKind.INVOICE,
        sha256,
        category: parseDocumentCategory(formData.get("documentCategory")) ?? "INVOICE",
      },
    });
  }

  return { success: "Saved", id: product.id, href: `/products/${product.id}` };
}

export async function importInventoryItem(formData: FormData): Promise<ImportResult> {
  const user = await requireUser();
  if (!(await isModuleEnabled("INVENTORY"))) return { error: "Inventory module is disabled." };

  const parsed = inventoryItemSchema.safeParse(formToInventoryItemInput(formData));
  if (!parsed.success) return { error: firstIssueMessage(parsed.error) };

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const rejection = await describeUploadRejection(file);
    if (rejection) return { error: rejection };
  }

  const item = await prisma.inventoryItem.create({
    data: { ...parsed.data, createdById: user.id },
  });

  if (file instanceof File && file.size > 0) {
    const { storedName, size, sha256, mimeType } = await saveInventoryItemDocument(item.id, file);
    await prisma.inventoryItemDocument.create({
      data: {
        inventoryItemId: item.id,
        filename: file.name.slice(0, 255),
        storedName,
        mimeType,
        size,
        sha256,
        category: parseDocumentCategory(formData.get("documentCategory")) ?? "RECEIPT",
      },
    });
  }

  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  return { success: "Saved", id: item.id, href: `/inventory/${item.id}` };
}

// The "Save to review later" path: save the file with no destination chosen.
// Classify or discard it later from the Inbox.
export async function saveToInbox(formData: FormData): Promise<ImportResult> {
  const user = await requireUser();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  const rejection = await describeUploadRejection(file);
  if (rejection) return { error: rejection };

  const buffer = Buffer.from(await file.arrayBuffer());
  const { storedName, size, sha256, mimeType } = await saveInboxDocument(file);
  const extractedText = await extractSearchableText(buffer, file.type);
  const { status, guessedType } = await computeInboxIntake({ extractedText, sha256 });

  const doc = await prisma.inboxDocument.create({
    data: {
      filename: file.name.slice(0, 255),
      storedName,
      mimeType,
      size,
      extractedText,
      uploadedById: user.id,
      sha256,
      status,
      guessedType,
    },
  });

  revalidatePath("/documents/inbox");
  revalidatePath("/documents");
  return { success: "Saved to inbox.", id: doc.id, href: "/documents/inbox" };
}

// Files an inbox document as a Contract/Product/Inventory item using the
// same import* actions above, then removes it from the inbox on success.
export async function classifyInboxDocument(
  inboxId: string,
  targetType: "CONTRACT" | "PRODUCT" | "INVENTORY",
  fields: FormData,
): Promise<ImportResult> {
  await requireUser();

  const doc = await prisma.inboxDocument.findUnique({ where: { id: inboxId } });
  if (!doc) return { error: "Document not found." };

  const buffer = await readInboxDocument(doc.storedName);
  fields.set("file", new File([buffer], doc.filename, { type: doc.mimeType }));

  const result =
    targetType === "CONTRACT"
      ? await importContract(fields)
      : targetType === "PRODUCT"
        ? await importProduct(fields)
        : await importInventoryItem(fields);

  if (!result.error) {
    await deleteInboxDocument(doc.storedName);
    await prisma.inboxDocument.delete({ where: { id: inboxId } });
    revalidatePath("/documents/inbox");
    revalidatePath("/documents");
  }

  return result;
}

export async function discardInboxDocument(inboxId: string): Promise<ImportResult> {
  await requireUser();

  const doc = await prisma.inboxDocument.findUnique({ where: { id: inboxId } });
  if (!doc) return { error: "Document not found." };

  await deleteInboxDocument(doc.storedName);
  await prisma.inboxDocument.delete({ where: { id: inboxId } });

  revalidatePath("/documents/inbox");
  revalidatePath("/documents");
  return { success: "Discarded." };
}

// Downgrades a POSSIBLE_DUPLICATE row back into the normal classify flow
// (#206) — used when the user confirms the hash match was a coincidence
// rather than a genuine re-upload.
export async function keepInboxDocumentSeparate(inboxId: string): Promise<ImportResult> {
  await requireUser();

  const doc = await prisma.inboxDocument.findUnique({ where: { id: inboxId } });
  if (!doc) return { error: "Document not found." };

  await prisma.inboxDocument.update({
    where: { id: inboxId },
    data: { status: doc.guessedType ? "NEEDS_REVIEW" : "NEEDS_CLASSIFICATION" },
  });

  revalidatePath("/documents/inbox");
  return { success: "Kept as a separate document." };
}

// Files an inbox document as a new version of an already-filed document
// (#206), instead of a separate record — used from the duplicate-review UI
// once the user confirms this really is a re-upload. Scoped to the three
// types the inbox can natively file into (matches classifyInboxDocument's
// boundary); a duplicate match in another domain is shown as informational
// only, since inbox filing doesn't reach those domains today.
export async function attachInboxDocumentAsVersion(
  inboxId: string,
  targetKind: "CONTRACT" | "PRODUCT" | "INVENTORY_ITEM",
  targetOwnerId: string,
  targetDocId: string,
): Promise<ImportResult> {
  await requireUser();

  const doc = await prisma.inboxDocument.findUnique({ where: { id: inboxId } });
  if (!doc) return { error: "Document not found." };

  // supersedesId is @unique per table, so this must point at the chain's
  // current head, not necessarily targetDocId itself — the hash match could
  // have landed on an already-superseded (non-head) version.
  const chain = await getDocumentVersionChain(targetKind, targetDocId);
  const headId = chain.length > 0 ? chain[chain.length - 1].id : targetDocId;

  const buffer = await readInboxDocument(doc.storedName);
  const file = new File([new Uint8Array(buffer)], doc.filename, { type: doc.mimeType });

  if (targetKind === "CONTRACT") {
    const { storedName, size, sha256, mimeType } = await saveDocument(targetOwnerId, file);
    await prisma.document.create({
      data: {
        contractId: targetOwnerId,
        filename: doc.filename,
        storedName,
        mimeType,
        size,
        sha256,
        supersedesId: headId,
        extractedText: doc.extractedText,
      },
    });
    revalidatePath(`/contracts/${targetOwnerId}`);
  } else if (targetKind === "PRODUCT") {
    const { storedName, size, sha256, mimeType } = await saveProductDocument(targetOwnerId, file);
    await prisma.productDocument.create({
      data: {
        productId: targetOwnerId,
        filename: doc.filename,
        storedName,
        mimeType,
        size,
        sha256,
        supersedesId: headId,
        extractedText: doc.extractedText,
      },
    });
    revalidatePath(`/products/${targetOwnerId}`);
  } else {
    const { storedName, size, sha256, mimeType } = await saveInventoryItemDocument(targetOwnerId, file);
    await prisma.inventoryItemDocument.create({
      data: {
        inventoryItemId: targetOwnerId,
        filename: doc.filename,
        storedName,
        mimeType,
        size,
        sha256,
        supersedesId: headId,
      },
    });
    revalidatePath(`/inventory/${targetOwnerId}`);
  }

  await deleteInboxDocument(doc.storedName);
  await prisma.inboxDocument.delete({ where: { id: inboxId } });

  revalidatePath("/documents/inbox");
  revalidatePath("/documents");
  return { success: "Attached as a new version." };
}
