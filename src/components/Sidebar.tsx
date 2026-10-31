"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flame, Settings, Search, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getNavItems, FOOTER_NAV } from "@/components/nav-items";
import type { ModuleKey } from "@/lib/modules/registry";
import { SignOutButton } from "@/components/SignOutButton";
import { openGlobalSearch } from "@/components/GlobalSearch";
import { InboxCountBadge, inboxLinkLabel } from "@/components/InboxCountBadge";
import { buttonClass } from "@/lib/buttonStyles";

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

  return (
    <aside className="hidden w-60 flex-col border-r border-border bg-surface md:flex">
      <div className="flex items-center gap-2 px-6 py-5">
        <Flame size={20} className="text-accent" />
        <span className="text-base font-medium">Hearth</span>
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={openGlobalSearch}
          className={buttonClass("secondary", { className: "w-full text-muted" })}
        >
          <Search size={16} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="rounded-lg border border-border px-1.5 py-0.5 text-xs">⌘K</kbd>
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {dashboardItems.map(({ href, label, icon: Icon }) => {
          const active = isActive(href, pathname);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                active
                  ? "bg-accent/10 text-accent"
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
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                active
                  ? "bg-accent/10 text-accent"
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
              aria-label={documents ? inboxLinkLabel(label, inboxCount) : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                active
                  ? "bg-accent/10 text-accent"
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

      <div className="border-t border-border px-3 py-3">
        <Link
          href={FOOTER_NAV.settings.href}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
            isActive("/settings", pathname)
              ? "bg-accent/10 text-accent"
              : "text-muted hover:bg-hover",
          )}
        >
          <Settings size={20} />
          {FOOTER_NAV.settings.label}
        </Link>
        <Link
          href={FOOTER_NAV.help.href}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
            isActive("/help", pathname)
              ? "bg-accent/10 text-accent"
              : "text-muted hover:bg-hover",
          )}
        >
          <HelpCircle size={20} />
          {FOOTER_NAV.help.label}
        </Link>
        <div className="mt-2 px-3">
          <p className="truncate text-sm font-medium">{userName}</p>
          <p className="truncate text-xs text-muted">{userEmail}</p>
          <SignOutButton className="mt-2 flex items-center gap-2 text-sm text-muted hover:text-foreground" />
        </div>
      </div>
    </aside>
  );
}
