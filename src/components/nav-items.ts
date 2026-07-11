import { LayoutDashboard, FileText, Package, CalendarDays, TrendingUp, type LucideIcon } from "lucide-react";
import { MODULE_REGISTRY, type ModuleKey } from "@/lib/modules/registry";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const BASE_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contracts", label: "Contracts", icon: FileText },
  { href: "/products", label: "Warranties", icon: Package },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/spend", label: "Spending", icon: TrendingUp },
];

export function getNavItems(enabledModules: Set<ModuleKey>): NavItem[] {
  const moduleItems = Object.values(MODULE_REGISTRY)
    .filter((module) => enabledModules.has(module.key))
    .map(({ href, label, icon }) => ({ href, label, icon }));

  return [...BASE_NAV_ITEMS, ...moduleItems];
}
