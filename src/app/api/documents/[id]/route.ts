import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { documentStoreFor } from "@/lib/storage";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { DOCUMENT_KIND_MODULE } from "@/lib/documents/kinds";
import { findDocumentAnyKind, isDocumentOwnerInTrash } from "@/lib/commands/documents";

// #396 — the one file route for a Document of every kind. The id alone
// finds it (cuids are unique across the 8 tables). Household-wide like the
// rest of the app: any signed-in member can read it, as long as the kind's
// module is on and neither the Document nor its record is in Trash. Each of
// those cases is a 404, so a disabled module doesn't reveal what exists.
// The old per-module routes redirect here. Inbox files keep their own
// route (/api/documents/inbox/[id]).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await findDocumentAnyKind(id);
  if (!doc || doc.deletedAt) return notFound();
  const moduleKey = DOCUMENT_KIND_MODULE[doc.kind];
  if (moduleKey && !(await isModuleEnabled(moduleKey))) return notFound();
  if (await isDocumentOwnerInTrash(doc)) return notFound();

  const buffer = await documentStoreFor(doc.kind).read(doc.ownerId, doc.storedName);
  const safeFilename = doc.filename.replace(/[\r\n"]/g, "_");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Content-Length": String(doc.size),
    },
  });
}
