import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { ENTITY_SYNC_CONFIGS } from "@/app/api/sync/entityHandlers";
import {
  assertRequestWithinUploadBudget,
  UploadRejectedError,
} from "@/lib/uploadValidation";

interface SyncOperation {
  id: string;
  entity: string;
  operation: "create" | "update" | "delete";
  entityId?: string;
  parentId?: string; // parent record ID (e.g. vehicleId for vehicleItem)
  formValues?: Record<string, string>;
  baseUpdatedAt?: string;
}

// Matches the client's own queue drain size (OfflineSyncManager); a request
// carrying more than this isn't something the app produces.
const MAX_SYNC_OPERATIONS = 200;

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

  // /api/sync is the one endpoint that carries many files in a single body —
  // a queue of offline edits replayed at once. The per-file cap doesn't bound
  // that total (#165).
  const allFiles = [...formData.values()].filter((v): v is File => v instanceof File);
  try {
    assertRequestWithinUploadBudget(allFiles);
  } catch (error) {
    if (error instanceof UploadRejectedError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    throw error;
  }

  // Bounds the work one request can queue up, independent of file size.
  if (operations.length > MAX_SYNC_OPERATIONS) {
    return NextResponse.json(
      {
        error: `Too many queued changes in one request (max ${MAX_SYNC_OPERATIONS}). ` +
          "They'll sync in smaller batches.",
      },
      { status: 413 },
    );
  }

  const results: SyncResult[] = [];

  for (const op of operations) {
    const claim = await claimOperation(session.user.id, op.id);
    if (!claim.ok) {
      results.push({ id: op.id, success: claim.success, error: claim.error });
      continue;
    }

    try {
      const files = filesForOp(formData, op.id);
      await processOperation(op, session.user.id, files);
      await settleOperation(session.user.id, op.id, { success: true });
      results.push({ id: op.id, success: true });
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      await settleOperation(session.user.id, op.id, { success: false, error });
      results.push({ id: op.id, success: false, error });
    }
  }

  return NextResponse.json({ results });
}

// A claim stuck at success: null past this age is treated as abandoned (the
// process that took it crashed or was killed mid-request) rather than
// genuinely in flight, so a later request for the same opId isn't blocked
// forever. Comfortably above how long a single operation should ever take.
const CLAIM_STALE_MS = 2 * 60_000;

type ClaimResult =
  | { ok: true }
  | { ok: false; success: boolean; error?: string };

// #249 — claims (userId, opId) via the unique index before executing, so two
// requests racing on the same operation (a genuine concurrent retry, not
// just a later one) can't both run the mutation: the loser's insert fails
// the unique constraint and it waits on the winner's outcome instead.
async function claimOperation(userId: string, opId: string): Promise<ClaimResult> {
  try {
    await prisma.syncOperationReceipt.create({ data: { userId, opId, success: null } });
    return { ok: true };
  } catch {
    // Unique constraint hit — a receipt already exists, from an earlier
    // request (replay) or one racing concurrently right now.
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const receipt = await prisma.syncOperationReceipt.findUnique({
      where: { userId_opId: { userId, opId } },
    });
    if (!receipt) break; // deleted between the failed create and this read — try claiming again below
    if (receipt.success !== null) {
      return { ok: false, success: receipt.success, error: receipt.error ?? undefined };
    }
    if (Date.now() - receipt.createdAt.getTime() > CLAIM_STALE_MS) {
      // Abandoned claim: take it over rather than wait on a request that's
      // never coming back.
      const reclaimed = await prisma.syncOperationReceipt.updateMany({
        where: { id: receipt.id, success: null },
        data: { createdAt: new Date() },
      });
      if (reclaimed.count === 1) return { ok: true };
      continue; // someone else reclaimed it first — re-check its outcome
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return {
    ok: false,
    success: false,
    error: "This change is already being synced elsewhere — try again shortly.",
  };
}

async function settleOperation(
  userId: string,
  opId: string,
  outcome: { success: boolean; error?: string },
): Promise<void> {
  await prisma.syncOperationReceipt.update({
    where: { userId_opId: { userId, opId } },
    data: { success: outcome.success, error: outcome.error ?? null },
  });
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

  const ctx = { userId, parentId: op.parentId, baseUpdatedAt: op.baseUpdatedAt };

  if (op.operation === "delete") {
    if (!op.entityId) throw new Error("Missing record to delete");
    if (!config.remove) throw new Error(`${op.entity} can't be deleted offline`);
    await config.remove(op.entityId, ctx);
    return;
  }

  if (!config.schema) throw new Error(`${op.entity} doesn't support this offline`);
  const parsed = config.schema.safeParse(op.formValues ?? {});
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid data");

  let recordId: string;
  if (op.operation === "create") {
    if (!config.create) throw new Error(`${op.entity} can't be created offline`);
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
