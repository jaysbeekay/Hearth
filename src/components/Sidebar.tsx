"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flame, Search, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { navCurrent } from "@/lib/navCurrent";
import { getNavItems, FOOTER_NAV } from "@/components/nav-items";
import type { ModuleKey } from "@/lib/modules/registry";
import { AccountMenu } from "@/components/AccountMenu";
import { accountCurrentClass, buttonClass, sidebarActiveClass } from "@/lib/ui";
import { openGlobalSearch } from "@/components/GlobalSearch";
import { InboxCountBadge, inboxLinkLabel } from "@/components/InboxCountBadge";

function isActive(href: string, pathname: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  userName,
  userEmail,
  enabledModules,
  chatConfigured,
  inboxCount,
}: {
  userName: string;
  userEmail: string;
  enabledModules: ModuleKey[];
  chatConfigured: boolean;
  inboxCount: number;
}) {
  const pathname = usePathname();
  const items = getNavItems(new Set(enabledModules), chatConfigured);
  const dashboardItems = items.filter((item) => item.group === "dashboard");
  const moduleItems = items.filter((item) => item.group === "modules");
  const toolItems = items.filter((item) => item.group === "tools");

  const helpActive = isActive(FOOTER_NAV.help.href, pathname);

  // Pinned to the viewport, so the account menu stays at the bottom-left
  // however long the page is; z-30 keeps its popover above the page.
  return (
    <aside aria-label="Sidebar" className="sticky top-0 z-30 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex items-center gap-2 px-6 py-4">
        <Flame size={20} className="text-accent" />
        <span className="text-xl font-medium">Hearth</span>
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={openGlobalSearch}
          className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted hover:bg-hover"
        >
          <Search size={16} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="rounded border border-border px-1.5 py-0.5 text-xs">⌘K</kbd>
        </button>
      </div>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3">
        {dashboardItems.map(({ href, label, icon: Icon }) => {
          const active = isActive(href, pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={navCurrent(href, pathname)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? sidebarActiveClass
                  : "text-muted hover:bg-hover",
              )}
            >
              <Icon size={20} />
              {label}
            </Link>
          );
        })}

        <p className="mt-4 px-3 pb-1 text-xs font-medium text-muted">
          Modules
        </p>
        {moduleItems.map(({ href, label, icon: Icon }) => {
          const active = isActive(href, pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={navCurrent(href, pathname)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? sidebarActiveClass
                  : "text-muted hover:bg-hover",
              )}
            >
              <Icon size={20} />
              {label}
            </Link>
          );
        })}

        <p className="mt-4 px-3 pb-1 text-xs font-medium text-muted">
          Tools
        </p>
        {toolItems.map(({ href, label, icon: Icon }) => {
          const active = isActive(href, pathname);
          const documents = href === "/documents";
          return (
            <Link
              key={href}
              href={href}
              aria-current={navCurrent(href, pathname)}
              aria-label={documents ? inboxLinkLabel(label, inboxCount) : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? sidebarActiveClass
                  : "text-muted hover:bg-hover",
              )}
            >
              <Icon size={20} />
              {label}
              {documents && <InboxCountBadge count={inboxCount} className="ml-auto" />}
            </Link>
          );
        })}
      </nav>

      {/* The account lives behind its avatar (Settings, Changelog,
          Feedback, Sign out, version), with Help beside it. */}
      <div className="relative flex items-center gap-1 border-t border-border px-3 py-3">
        <AccountMenu userName={userName} userEmail={userEmail} />
        <Link
          href={FOOTER_NAV.help.href}
          aria-label={FOOTER_NAV.help.label}
          aria-current={navCurrent(FOOTER_NAV.help.href, pathname)}
          className={buttonClass("quiet", { icon: true }, helpActive ? accountCurrentClass : "text-muted")}
        >
          <HelpCircle size={20} />
        </Link>
      </div>
    </aside>
  );
}
