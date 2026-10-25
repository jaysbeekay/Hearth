"use server";

import { auth } from "@/lib/auth";
import type { ActionState } from "@/lib/actions/auth";
import {
  addDocumentCommand,
  deleteDocumentCommand,
  restoreDocumentCommand,
  permanentlyDeleteDocumentCommand,
  setDocumentImportantCommand,
} from "@/lib/commands/documents";
import { documentCommandError as commandError } from "@/lib/documents/commandErrors";
import { isOwnedDocumentKind, type OwnedDocumentKind } from "@/lib/documents/kinds";
import { parseDocumentCategory, type DocumentCategory } from "@/lib/documents/categories";
import { ProductDocumentKind } from "@/generated/prisma/enums";

// The Document actions for every kind (#396), replacing the per-owner
// add*/delete*/restore*/permanentlyDelete*/set*Important actions that used
// to live in each domain's actions file. They own sign-in, the READONLY
// check and form parsing; src/lib/commands/documents.ts owns the module
// gate, the write and revalidation.

async function requireWriter() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (session.user.role === "READONLY") throw new Error("Your account has read-only access.");
  return session.user;
}

// Bound arguments come back from the client, so the kind is checked here
// rather than trusted as a type.
function requireKind(kind: unknown): OwnedDocumentKind {
  if (!isOwnedDocumentKind(kind)) throw new Error("Unknown document kind");
  return kind;
}


// #350 — the upload form offers one "Document type" select; a Product
// Document's legacy kind is derived from it, so a "Photo" upload still
// becomes the warranty's hero image and an invoice/receipt is OCR'd.
function productKindFromCategory(category: DocumentCategory | null): ProductDocumentKind {
  switch (category) {
    case "INVOICE":
    case "RECEIPT":
      return ProductDocumentKind.INVOICE;
    case "PHOTO":
      return ProductDocumentKind.PHOTO;
    case "MANUAL":
      return ProductDocumentKind.MANUAL;
    default:
      return ProductDocumentKind.OTHER;
  }
}

function parseProductKind(value: FormDataEntryValue | null): ProductDocumentKind | null {
  const allowed = Object.values(ProductDocumentKind) as string[];
  return typeof value === "string" && allowed.includes(value) ? (value as ProductDocumentKind) : null;
}

/** Upload form action: `addDocumentAction.bind(null, kind, ownerId)`. */
export async function addDocumentAction(
  kind: OwnedDocumentKind,
  ownerId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireWriter();
  const documentKind = requireKind(kind);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  const category = parseDocumentCategory(formData.get("documentCategory"));
  // An explicit kind still wins, for callers that send one.
  const productKind =
    documentKind === "PRODUCT" ? (parseProductKind(formData.get("kind")) ?? productKindFromCategory(category)) : undefined;

  try {
    await addDocumentCommand(documentKind, ownerId, { file, category, productKind });
  } catch (error) {
    return commandError(error);
  }
  return { success: "Document uploaded." };
}

/**
 * Moves a Document to Trash. `ownerId`, when given, must be the record the
 * list showed it under.
 */
export async function deleteDocumentAction(
  kind: OwnedDocumentKind,
  documentId: string,
  ownerId?: string,
): Promise<ActionState> {
  await requireWriter();
  try {
    await deleteDocumentCommand(requireKind(kind), documentId, { ownerId });
  } catch (error) {
    return commandError(error);
  }
  return { success: "Document moved to Trash." };
}

export async function restoreDocumentAction(kind: OwnedDocumentKind, documentId: string): Promise<ActionState> {
  await requireWriter();
  try {
    await restoreDocumentCommand(requireKind(kind), documentId);
  } catch (error) {
    return commandError(error);
  }
  return { success: "Restored." };
}

export async function permanentlyDeleteDocumentAction(
  kind: OwnedDocumentKind,
  documentId: string,
): Promise<ActionState> {
  await requireWriter();
  try {
    await permanentlyDeleteDocumentCommand(requireKind(kind), documentId);
  } catch (error) {
    return commandError(error);
  }
  return { success: "Deleted permanently." };
}

/** Stars or unstars a Document. */
export async function setDocumentImportantAction(
  kind: OwnedDocumentKind,
  documentId: string,
  isImportant: boolean,
): Promise<ActionState> {
  await requireWriter();
  try {
    await setDocumentImportantCommand(requireKind(kind), documentId, isImportant);
  } catch (error) {
    return commandError(error);
  }
  return { success: isImportant ? "Marked as important." : "Unmarked as important." };
}
