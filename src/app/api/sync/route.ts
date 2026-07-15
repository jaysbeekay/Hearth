import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { ENTITY_SYNC_CONFIGS } from "@/app/api/sync/entityHandlers";

interface SyncOperation {
  id: string;
  entity: string;
  operation: "create" | "update" | "delete";
  entityId?: string;
  parentId?: string; // parent record ID (e.g. vehicleId for vehicleItem)
  formValues?: Record<string, string>;
}

interface SyncResult {
  id: string;
  success: boolean;
  error?: string;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role === "READONLY") {
    return NextResponse.json({ error: "Your account has read-only access." }, { status: 403 });
  }

  // Always multipart: the client sends a JSON "operations" field alongside
  // any staged file parts, keyed "file:<opId>:<fieldName>" (see
  // OfflineSyncManager.tsx) — files can't ride along in a JSON body.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let operations: SyncOperation[];
  try {
    operations = JSON.parse(String(formData.get("operations") ?? "[]"));
  } catch {
    return NextResponse.json({ error: "Invalid operations JSON" }, { status: 400 });
  }
  if (!Array.isArray(operations)) {
    return NextResponse.json({ error: "operations must be an array" }, { status: 400 });
  }

  const results: SyncResult[] = [];

  for (const op of operations) {
    try {
      const files = filesForOp(formData, op.id);
      await processOperation(op, session.user.id, files);
      results.push({ id: op.id, success: true });
    } catch (err) {
      results.push({
        id: op.id,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ results });
}

function filesForOp(formData: FormData, opId: string): { fieldName: string; file: File }[] {
  const files: { fieldName: string; file: File }[] = [];
  const prefix = `file:${opId}:`;
  for (const [key, value] of formData.entries()) {
    if (key.startsWith(prefix) && value instanceof File) {
      files.push({ fieldName: key.slice(prefix.length), file: value });
    }
  }
  return files;
}

async function processOperation(
  op: SyncOperation,
  userId: string,
  files: { fieldName: string; file: File }[],
): Promise<void> {
  const config = ENTITY_SYNC_CONFIGS[op.entity];
  if (!config) throw new Error(`Unsupported entity: ${op.entity}`);

  if (config.requiresModule && !(await isModuleEnabled(config.requiresModule))) {
    throw new Error(`${MODULE_REGISTRY[config.requiresModule].label} module is disabled`);
  }

  const ctx = { userId, parentId: op.parentId };

  if (op.operation === "delete") {
    if (!op.entityId) throw new Error("Missing record to delete");
    if (!config.remove) throw new Error(`${op.entity} can't be deleted offline`);
    await config.remove(op.entityId, ctx);
    return;
  }

  const parsed = config.schema.safeParse(op.formValues ?? {});
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid data");

  let recordId: string;
  if (op.operation === "create") {
    recordId = (await config.create(parsed.data, ctx)).id;
  } else if (op.operation === "update") {
    if (!op.entityId) throw new Error("Missing record to update");
    if (!config.update) throw new Error(`${op.entity} can't be edited offline`);
    await config.update(op.entityId, parsed.data, ctx);
    recordId = op.entityId;
  } else {
    throw new Error(`Unsupported operation: ${op.operation}`);
  }

  if (files.length > 0 && config.saveFile) {
    for (const { fieldName, file } of files) {
      await config.saveFile(recordId, file, fieldName);
    }
  }
}
