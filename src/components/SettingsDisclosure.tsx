"use client";

import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { RowSummary, rowClass } from "@/components/settingsRowParts";
import { cardClass } from "@/lib/ui";
import { cn } from "@/lib/utils";

// Feedback the app renders inside a row: FormMessage's role="alert" error
// (in the banner or under its field) and the aria-invalid it puts on the field.
const FEEDBACK = '[role="alert"], [aria-invalid="true"]';

function isFeedback(node: Node): boolean {
  return node instanceof Element && (node.matches(FEEDBACK) || node.querySelector(FEEDBACK) !== null);
}

/** Whether a mutation added an error or marked a field invalid. */
function showsFeedback(record: MutationRecord): boolean {
  if (record.type === "attributes") return record.target instanceof Element && record.target.matches(FEEDBACK);
  return [...record.addedNodes].some(isFeedback);
}

/** The element the URL's fragment names, if any. */
function hashTarget(): HTMLElement | null {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  try {
    return document.getElementById(decodeURIComponent(hash));
  } catch {
    return null;
  }
}

/**
 * A row that drops down in place to show its settings. A closed row never
 * hides feedback: it opens on its own when the page's URL names it or a
 * field in it (/settings#preferences), when the browser's validation flags a
 * field inside it, and when the app shows an error inside it (a save that
 * the server rejected).
 */
export function SettingsDisclosureClient({
  id,
  label,
  summary,
  children,
}: {
  id: string;
  /** The row's icon and name, rendered by SettingsDisclosure. */
  label: React.ReactNode;
  summary?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function openFromHash() {
      const details = ref.current;
      const target = hashTarget();
      if (!details || !target || !details.contains(target)) return;
      details.open = true;
      // Only the row itself is scrolled to; a field inside it is the
      // browser's own fragment target, which it can reach now it's open.
      if (target === details) details.scrollIntoView({ block: "start" });
      else target.scrollIntoView({ block: "center" });
    }
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => {
      window.removeEventListener("hashchange", openFromHash);
    };
  }, [id]);

  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    if (details.querySelector(FEEDBACK)) details.open = true;
    // Opens when feedback appears, not whenever some stays: a row the user
    // closes over an old error stays closed. FormMessage marks an error when
    // the action returns and scrolls to it a frame later; this observer's
    // microtask opens the row first.
    const observer = new MutationObserver((records) => {
      if (!details.open && records.some(showsFeedback)) details.open = true;
    });
    observer.observe(details, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["role", "aria-invalid"],
    });
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <li>
      <details
        ref={ref}
        id={id}
        data-settings-row
        // `invalid` doesn't bubble, so catch it on the way down.
        // Opened while the event is dispatched, so the browser can then
        // focus the field and show its message.
        onInvalidCapture={(e) => {
          e.currentTarget.open = true;
        }}
        className={cardClass({ padding: "none" }, "group scroll-mt-20 md:scroll-mt-4")}
      >
        <summary
          className={cn(
            rowClass,
            "cursor-pointer list-none rounded-lg transition-colors hover:bg-hover [&::-webkit-details-marker]:hidden",
          )}
        >
          {label}
          <span className="flex min-w-0 items-center gap-2">
            <RowSummary summary={summary} />
            <ChevronDown
              size={16}
              aria-hidden
              className="shrink-0 text-muted transition-transform group-open:rotate-180"
            />
          </span>
        </summary>
        <div className="border-t border-border p-4">{children}</div>
      </details>
    </li>
  );
}
