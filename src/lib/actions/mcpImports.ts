"use server";

import { auth } from "@/lib/auth";
import { approveImportCommand, ImportReviewError, rejectImportCommand } from "@/lib/mcp/imports";
import { RecordNotFoundError, RecordValidationError } from "@/lib/commands/shared";
import { ModuleDisabledError } from "@/lib/modules/enablement";

// Review actions for records an MCP agent proposed importing (#529). Any
// non-READONLY member may approve or reject, like creating a record in the UI.

export type ImportReviewResult = { ok: number; failed: { id: string; error: string }[] };

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (session.user.role === "READONLY") throw new Error("Your account has read-only access.");
  return session.user;
}

function reviewError(error: unknown): string {
  if (
    error instanceof ImportReviewError ||
    error instanceof RecordValidationError ||
    error instanceof RecordNotFoundError ||
    error instanceof ModuleDisabledError
  ) {
    return error.message;
  }
  console.error("[mcp-import] review failed:", error);
  return "Couldn't save that import.";
}

const MAX_BATCH = 100;

async function reviewEach(
  ids: string[],
  run: (id: string, actorId: string) => Promise<unknown>,
): Promise<ImportReviewResult> {
  const user = await requireUser();
  // A server action's argument is whatever the client sent: check its shape,
  // and cap it before doing any work on it.
  if (!Array.isArray(ids)) throw new Error("Invalid import selection.");
  const unique = [...new Set(ids.slice(0, MAX_BATCH).filter((id) => typeof id === "string" && id.length > 0))];
  const result: ImportReviewResult = { ok: 0, failed: [] };
  // One at a time: each approval is its own record write, and one failure
  // (say, a proposal that no longer validates) mustn't stop the rest.
  for (const id of unique) {
    try {
      await run(id, user.id);
      result.ok += 1;
    } catch (error) {
      result.failed.push({ id, error: reviewError(error) });
    }
  }
  return result;
}

export async function approveMcpImports(ids: string[]): Promise<ImportReviewResult> {
  return reviewEach(ids, approveImportCommand);
}

export async function rejectMcpImports(ids: string[]): Promise<ImportReviewResult> {
  return reviewEach(ids, rejectImportCommand);
}
