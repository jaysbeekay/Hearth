"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { getNavItems } from "@/components/nav-items";
import type { ModuleKey } from "@/lib/modules/registry";

function isActive(href: string, pathname: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav({ enabledModules }: { enabledModules: ModuleKey[] }) {
  const pathname = usePathname();
  const items = getNavItems(new Set(enabledModules));

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface md:hidden">
      {items.map(({ href, label, icon: Icon }) => {
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
      <Link
        href="/settings"
        className={cn(
          "flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium",
          isActive("/settings", pathname) ? "text-accent" : "text-foreground/60",
        )}
      >
        <Settings size={20} />
        Settings
      </Link>
    </nav>
  );
}
