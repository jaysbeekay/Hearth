"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, MoreHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getNavItems } from "@/components/nav-items";
import type { ModuleKey } from "@/lib/modules/registry";

function isActive(href: string, pathname: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Fixed regardless of how many modules are enabled — everything else
// (Spend, module items, Settings) lives in the "More" sheet so the bar
// never grows past 5 slots on small screens.
const PRIMARY_HREFS = ["/dashboard", "/contracts", "/products", "/calendar"];

export function BottomNav({ enabledModules }: { enabledModules: ModuleKey[] }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = getNavItems(new Set(enabledModules));

  useEffect(() => {
    if (!moreOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [moreOpen]);

  // Close automatically on route change (link click).
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const primary = PRIMARY_HREFS.map((href) => items.find((i) => i.href === href)).filter(
    (i): i is NonNullable<typeof i> => i != null,
  );
  const overflow = items.filter((i) => !PRIMARY_HREFS.includes(i.href));
  const overflowActive =
    overflow.some((i) => isActive(i.href, pathname)) || isActive("/settings", pathname);

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface md:hidden">
        {primary.map(({ href, label, icon: Icon }) => {
          const active = isActive(href, pathname);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium",
                active ? "text-accent" : "text-foreground/60",
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
            overflowActive ? "text-accent" : "text-foreground/60",
          )}
        >
          <MoreHorizontal size={20} />
          More
        </button>
      </nav>

      {moreOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end bg-black/40 md:hidden"
          onClick={() => setMoreOpen(false)}
        >
          <div
            role="dialog"
            aria-label="More navigation options"
            className="w-full rounded-t-2xl border-t border-border bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-muted">More</span>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="rounded-full p-1.5 hover:bg-black/5 dark:hover:bg-white/5"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {overflow.map(({ href, label, icon: Icon }) => (
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
            </div>
          </div>
        </div>
      )}
    </>
  );
}
