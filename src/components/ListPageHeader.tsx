import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";
import { DetailOverflowMenu } from "@/components/DetailOverflowMenu";
import { cn } from "@/lib/utils";
import { exportMenuItemClass, linkButtonClass, toolbarButtonClass } from "@/lib/buttonStyles";

export interface ListPageAction {
  href: string;
  label: string;
  /** "primary" is an Add button with a + icon; "secondary" a plain bordered link. */
  variant?: "primary" | "secondary";
  online?: boolean;
}

// The heading row every list page shares (#369). From `md` up it is one row:
// heading on the left, Export ▾ and the page's button on the right. Below
// `md` the heading keeps its own line with Export tucked into the ⋮ menu
// beside it, and the button drops underneath at full width, so nothing
// wraps on a 360px phone. Callers leave `action` out for read-only members.
export function ListPageHeader({
  title,
  exportPath,
  action,
}: {
  title: string;
  /** e.g. "/api/export/contracts"; the CSV and PDF links add ?format=. */
  exportPath?: string;
  action?: ListPageAction;
}) {
  const online = action?.online ?? true;
  return (
    <div className="space-y-3 md:flex md:items-center md:justify-between md:gap-4 md:space-y-0">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {exportPath && (
          <div className="md:hidden">
            <DetailOverflowMenu label="More list actions">
              <a href={`${exportPath}?format=csv`} download className={exportMenuItemClass}>
                Export CSV
              </a>
              <a href={`${exportPath}?format=pdf`} download className={exportMenuItemClass}>
                Export PDF
              </a>
            </DetailOverflowMenu>
          </div>
        )}
      </div>
      {(exportPath || action) && (
        <div className={cn("items-center gap-2", action ? "flex" : "hidden md:flex")}>
          {exportPath && (
            <details className="relative hidden md:block">
              <summary className={toolbarButtonClass}>
                Export <ChevronDown size={14} />
              </summary>
              <div className="absolute right-0 z-10 mt-1 w-28 overflow-hidden rounded-lg border border-border bg-surface shadow-md">
                <a href={`${exportPath}?format=csv`} download className={exportMenuItemClass}>CSV</a>
                <a href={`${exportPath}?format=pdf`} download className={exportMenuItemClass}>PDF</a>
              </div>
            </details>
          )}
          {action && (
            <Link
              href={action.href}
              aria-disabled={!online}
              tabIndex={!online ? -1 : undefined}
              className={cn(
                action.variant === "secondary"
                  ? cn(toolbarButtonClass, !online && "pointer-events-none opacity-40")
                  : linkButtonClass("primary", { online }),
                "w-full justify-center whitespace-nowrap md:w-auto",
              )}
            >
              {action.variant !== "secondary" && <Plus size={16} />}
              {action.label}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
