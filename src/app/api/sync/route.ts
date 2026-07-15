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
  formValues: Record<string, string>;
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

  let body: { operations: SyncOperation[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body?.operations)) {
    return NextResponse.json({ error: "operations must be an array" }, { status: 400 });
  }

  const results: SyncResult[] = [];

  for (const op of body.operations) {
    try {
      await processOperation(op, session.user.id);
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

async function processOperation(op: SyncOperation, userId: string): Promise<void> {
  const config = ENTITY_SYNC_CONFIGS[op.entity];
  if (!config) throw new Error(`Unsupported entity: ${op.entity}`);

  if (config.requiresModule && !(await isModuleEnabled(config.requiresModule))) {
    throw new Error(`${MODULE_REGISTRY[config.requiresModule].label} module is disabled`);
  }

  const parsed = config.schema.safeParse(op.formValues);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid data");

  const ctx = { userId, parentId: op.parentId };

  if (op.operation === "create") {
    await config.create(parsed.data, ctx);
  } else if (op.operation === "update") {
    if (!op.entityId) throw new Error("Missing record to update");
    if (!config.update) throw new Error(`${op.entity} can't be edited offline`);
    await config.update(op.entityId, parsed.data, ctx);
  } else {
    throw new Error(`Unsupported operation: ${op.operation}`);
  }
}
