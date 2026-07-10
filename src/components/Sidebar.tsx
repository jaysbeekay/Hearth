"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileSignature, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { getNavItems } from "@/components/nav-items";
import type { ModuleKey } from "@/lib/modules/registry";
import { SignOutButton } from "@/components/SignOutButton";

function isActive(href: string, pathname: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  userName,
  userEmail,
  enabledModules,
}: {
  userName: string;
  userEmail: string;
  enabledModules: ModuleKey[];
}) {
  const pathname = usePathname();
  const items = getNavItems(new Set(enabledModules));

  return (
    <aside className="hidden w-60 flex-col border-r border-border bg-surface md:flex">
      <div className="flex items-center gap-2 px-6 py-5">
        <FileSignature size={22} className="text-accent" />
        <span className="text-lg font-semibold">Hearth</span>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActive(href, pathname);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                active
                  ? "bg-accent/10 text-accent"
                  : "text-muted hover:bg-black/5 dark:hover:bg-white/5",
              )}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-3 py-3">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
            isActive("/settings", pathname)
              ? "bg-accent/10 text-accent"
              : "text-muted hover:bg-black/5 dark:hover:bg-white/5",
          )}
        >
          <Settings size={18} />
          Settings
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
