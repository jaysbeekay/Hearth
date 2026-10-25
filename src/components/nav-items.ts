import { LayoutDashboard, FileText, Package, CalendarDays, TrendingUp, Files, Bot, type LucideIcon } from "lucide-react";
import { MODULE_REGISTRY, type ModuleKey } from "@/lib/modules/registry";

// "dashboard" stands alone (not part of either group); "modules" are
// record-type sections (Contracts, Warranties, plus
// whichever optional modules are enabled); "tools" are cross-cutting views
// that work across all record types (Documents, Upcoming, Spending,
// Assistant).
export type NavGroup = "dashboard" | "modules" | "tools";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
}

const BASE_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "dashboard" },
  // #362 — one name per object: the nav label is also the page's <h1> and
  // metadata.title, and the BackLink label for anything returning here.
  // "Contracts" and "Warranties" are interim nouns until #380 renames
  // Warranties to Items. Search still recognises the older words ("policy",
  // "purchase", "product"…) via CONTRACT_ALIASES/PRODUCT_ALIASES in
  // src/app/api/search/route.ts, and the /contracts, /products routes and
  // Contract/Product model names are untouched.
  { href: "/contracts", label: "Contracts", icon: FileText, group: "modules" },
  { href: "/products", label: "Warranties", icon: Package, group: "modules" },
  { href: "/documents", label: "Documents", icon: Files, group: "tools" },
  { href: "/assistant", label: "Assistant", icon: Bot, group: "tools" },
  { href: "/calendar", label: "Upcoming", icon: CalendarDays, group: "tools" },
  { href: "/spend", label: "Spending", icon: TrendingUp, group: "tools" },
];

// Always shown below the module and tool groups, in every nav (Sidebar,
// MobileNavDrawer, BottomNav's More sheet).
export const FOOTER_NAV = {
  settings: { href: "/settings", label: "Settings" },
  help: { href: "/help", label: "Help" },
} as const;

export function getNavItems(enabledModules: Set<ModuleKey>, chatConfigured: boolean): NavItem[] {
  const moduleItems = Object.values(MODULE_REGISTRY)
    .filter((module) => module.key !== "INVENTORY" && enabledModules.has(module.key))
    .map(({ href, label, icon }): NavItem => ({ href, label, icon, group: "modules" }));

  return [...BASE_NAV_ITEMS, ...moduleItems].filter(
    (item) => item.href !== "/assistant" || chatConfigured,
  );
}
