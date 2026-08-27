import { LayoutDashboard, FileText, Package, CalendarDays, TrendingUp, Files, Bot, type LucideIcon } from "lucide-react";
import { MODULE_REGISTRY, type ModuleKey } from "@/lib/modules/registry";

// "dashboard" stands alone (not part of either group); "modules" are
// record-type sections (Contracts, Warranties, plus whichever optional
// modules are enabled); "tools" are cross-cutting views that work across
// all record types (Documents, Calendar, Spending, Assistant).
export type NavGroup = "dashboard" | "modules" | "tools";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
}

const BASE_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "dashboard" },
  { href: "/contracts", label: "Contracts", icon: FileText, group: "modules" },
  { href: "/products", label: "Warranties", icon: Package, group: "modules" },
  { href: "/documents", label: "Documents", icon: Files, group: "tools" },
  { href: "/assistant", label: "Assistant", icon: Bot, group: "tools" },
  { href: "/calendar", label: "Upcoming", icon: CalendarDays, group: "tools" },
  { href: "/spend", label: "Spending", icon: TrendingUp, group: "tools" },
];

export function getNavItems(enabledModules: Set<ModuleKey>, chatConfigured: boolean): NavItem[] {
  const moduleItems = Object.values(MODULE_REGISTRY)
    .filter((module) => enabledModules.has(module.key))
    .map(({ href, label, icon }): NavItem => ({ href, label, icon, group: "modules" }));

  return [...BASE_NAV_ITEMS, ...moduleItems].filter(
    (item) => item.href !== "/assistant" || chatConfigured,
  );
}
