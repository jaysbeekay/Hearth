"use client";

import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { RowSummary, rowClass } from "@/components/settingsRowParts";
import { cardClass } from "@/lib/ui";
import { cn } from "@/lib/utils";

/**
 * A row that drops down in place to show its settings. It opens on its own
 * when the page's URL names it (/settings#preferences), and when the
 * browser's validation flags a field inside it, so a closed row never hides
 * the field that stopped a save.
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
      if (ref.current && window.location.hash === `#${id}`) {
        ref.current.open = true;
        ref.current.scrollIntoView({ block: "start" });
      }
    }
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => {
      window.removeEventListener("hashchange", openFromHash);
    };
  }, [id]);

  return (
    <li>
      <details
        ref={ref}
        id={id}
        data-settings-row
        // `invalid` doesn't bubble, so catch it on the way down.
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
