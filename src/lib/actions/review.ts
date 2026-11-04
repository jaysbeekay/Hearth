"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { confirmContractExtractionCommand } from "@/lib/commands/contracts";
import { confirmProductExtractionCommand } from "@/lib/commands/products";
import { RecordNotFoundError, RecordValidationError, StaleEditError } from "@/lib/commands/shared";
import { contractReviewCorrectionsFromForm, productReviewCorrectionsFromForm } from "@/lib/documents/extractionReview";
import type { ActionState } from "@/lib/actions/auth";

// #358 — "Confirm all" on the Quick check screen: confirms every listed
// record's auto-filled details at once, with any corrections typed there.
// Each record's fields arrive as `<KIND>:<id>:reviewField:<field>`; they're
// handed to the same per-record review the detail page's panel uses, so the
// same fields are checked the same way.
//
// Each record is confirmed on its own, in its own transaction: "Confirm all"
// is not all-or-nothing. A record that fails (a correction that doesn't
// validate, or an edit someone else saved after this page loaded, caught by
// its `version`) stays listed with what went wrong, the others are
// confirmed, and pressing it again only confirms what is still waiting.

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Not signed in");
  if (session.user.role === "READONLY") throw new Error("Your account has read-only access.");
  return session.user;
}

const RECORD = /^(CONTRACT|PRODUCT):([A-Za-z0-9_-]{1,64})$/;

/** The review panel's own form for one record, cut out of the combined form. */
function recordReviewForm(formData: FormData, prefix: string): FormData {
  const sub = new FormData();
  for (const [key, value] of formData.entries()) {
    if (key.startsWith(prefix) && typeof value === "string") sub.append(key.slice(prefix.length), value);
  }
  return sub;
}

export async function confirmAllExtractions(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const records = formData
    .getAll("record")
    .map((value) => (typeof value === "string" ? RECORD.exec(value) : null))
    .filter((match): match is RegExpExecArray => match !== null);
  if (records.length === 0) return { error: "Nothing to confirm." };

  let confirmed = 0;
  const problems: string[] = [];
  for (const [, kind, id] of records) {
    const sub = recordReviewForm(formData, `${kind}:${id}:`);
    const label = formData.get(`${kind}:${id}:label`);
    const version = formData.get(`${kind}:${id}:version`);
    const options = { baseUpdatedAt: typeof version === "string" && version ? version : undefined };
    const name = typeof label === "string" && label ? label : "A record";
    try {
      if (kind === "CONTRACT") {
        await confirmContractExtractionCommand(id, contractReviewCorrectionsFromForm(sub), user.id, options);
      } else {
        await confirmProductExtractionCommand(id, productReviewCorrectionsFromForm(sub), user.id, options);
      }
      confirmed += 1;
    } catch (error) {
      if (error instanceof RecordNotFoundError) continue;
      if (error instanceof StaleEditError) {
        problems.push(`${name}: someone changed it since this page loaded, so check it again`);
      } else if (error instanceof RecordValidationError) {
        problems.push(`${name}: ${error.message}`);
      } else {
        // Keep going: the records before and after this one are independent.
        console.error("[review] confirming", kind, id, error);
        problems.push(`${name}: couldn't be confirmed, please try again`);
      }
    }
  }
  revalidatePath("/review");
  revalidatePath("/dashboard");
  if (problems.length > 0) {
    return {
      error: `${confirmed} confirmed. Fix ${problems.length === 1 ? "this one" : "these"} and confirm again: ${problems.join("; ")}`,
    };
  }
  return { success: `${confirmed} ${confirmed === 1 ? "record" : "records"} confirmed.` };
}
