import { RecordNotFoundError, RecordValidationError } from "@/lib/commands/shared";
import { DocumentNotInTrashError } from "@/lib/commands/documents";
import { ModuleDisabledError } from "@/lib/modules/enablement";
import { UploadRejectedError } from "@/lib/uploadValidation";

// Turns a Document command's expected failures into the `{ error }` a form
// or toast shows; anything else is unexpected and rethrown. Shared by the
// Document actions and the Inbox's "attach as a new version".
export function documentCommandError(error: unknown): { error: string } {
  if (error instanceof RecordNotFoundError) return { error: `${error.message}.` };
  if (
    error instanceof ModuleDisabledError ||
    error instanceof UploadRejectedError ||
    error instanceof DocumentNotInTrashError ||
    error instanceof RecordValidationError
  ) {
    return { error: error.message };
  }
  throw error;
}
