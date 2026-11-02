import Link from "next/link";
import { buttonClass } from "@/lib/ui";

/**
 * #406 — the one footer for a record form: Cancel beside Save. Cancel is a
 * plain link back to where the page's BackLink goes (the record for an edit,
 * the list or parent record for an add), so it discards the form without a
 * round trip. `children` is the form's SubmitButton.
 */
export function FormActions({ cancelHref, children }: { cancelHref: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <Link href={cancelHref} className={buttonClass("secondary")}>
        Cancel
      </Link>
      {children}
    </div>
  );
}
