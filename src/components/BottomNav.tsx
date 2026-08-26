"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, HelpCircle, MoreHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getNavItems } from "@/components/nav-items";
import type { ModuleKey } from "@/lib/modules/registry";
import { Dialog } from "@/components/Dialog";

function isActive(href: string, pathname: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Fixed regardless of how many modules are enabled — everything else
// (Calendar, Spend, module items, Settings) lives in the "More" sheet so the
// bar never grows past 5 slots on small screens. Documents is promoted here
// over Calendar since capturing/reviewing receipts is a primary, frequent
// action, while calendar is a secondary/glanceable view (#173).
const PRIMARY_HREFS = ["/dashboard", "/contracts", "/products", "/documents"];

export function BottomNav({
  enabledModules,
  chatConfigured,
}: {
  enabledModules: ModuleKey[];
  chatConfigured: boolean;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = getNavItems(new Set(enabledModules), chatConfigured);

  // Close automatically on route change (link click).
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMoreOpen(false);
  }

  const primary = PRIMARY_HREFS.map((href) => items.find((i) => i.href === href)).filter(
    (i): i is NonNullable<typeof i> => i != null,
  );
  const overflow = items.filter((i) => !PRIMARY_HREFS.includes(i.href));
  const overflowModules = overflow.filter((i) => i.group === "modules");
  const overflowTools = overflow.filter((i) => i.group === "tools");
  const overflowActive =
    overflow.some((i) => isActive(i.href, pathname)) ||
    isActive("/settings", pathname) ||
    isActive("/help", pathname);

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {primary.map(({ href, label, icon: Icon }) => {
          const active = isActive(href, pathname);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium",
                active ? "text-accent" : "text-muted",
              )}
            >
              <Icon size={20} />
              {label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="More navigation options"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={cn(
            "flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium",
            overflowActive ? "text-accent" : "text-muted",
          )}
        >
          <MoreHorizontal size={20} />
          More
        </button>
      </nav>

      <Dialog
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        label="More navigation options"
        backdropClassName="fixed inset-0 z-40 flex items-end bg-black/40 md:hidden"
        panelClassName="w-full rounded-t-2xl border-t border-border bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        <>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-muted">More</span>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="flex size-11 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/5"
              >
                <X size={18} />
              </button>
            </div>
            {overflowModules.length > 0 && (
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                Modules
              </p>
            )}
            <div className="grid grid-cols-3 gap-2">
              {overflowModules.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg p-3 text-xs font-medium",
                    isActive(href, pathname)
                      ? "bg-accent/10 text-accent"
                      : "text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5",
                  )}
                >
                  <Icon size={20} />
                  {label}
                </Link>
              ))}
            </div>

            {overflowTools.length > 0 && (
              <p className="mb-1.5 mt-3 text-xs font-semibold uppercase tracking-wide text-muted">
                Tools
              </p>
            )}
            <div className="grid grid-cols-3 gap-2">
              {overflowTools.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg p-3 text-xs font-medium",
                    isActive(href, pathname)
                      ? "bg-accent/10 text-accent"
                      : "text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5",
                  )}
                >
                  <Icon size={20} />
                  {label}
                </Link>
              ))}
              <Link
                href="/settings"
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg p-3 text-xs font-medium",
                  isActive("/settings", pathname)
                    ? "bg-accent/10 text-accent"
                    : "text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5",
                )}
              >
                <Settings size={20} />
                Settings
              </Link>
              <Link
                href="/help"
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg p-3 text-xs font-medium",
                  isActive("/help", pathname)
                    ? "bg-accent/10 text-accent"
                    : "text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5",
                )}
              >
                <HelpCircle size={20} />
                Help
              </Link>
            </div>
        </>
      </Dialog>
    </>
  );
}
