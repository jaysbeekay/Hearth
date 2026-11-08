import {
  LayoutDashboard,
  FileText,
  ShieldCheck,
  CalendarDays,
  TrendingUp,
  Files,
  Bot,
  HelpCircle,
  House,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { MODULE_REGISTRY, type ModuleKey } from "@/lib/modules/registry";
import { SETTINGS_ROUTES, settingsArea } from "@/lib/routeLabels";

// "dashboard" stands alone (not part of either group); "modules" are
// record-type sections (Contracts, Warranties, plus whichever optional
// modules are enabled), listed alphabetically by label; "tools" are cross-cutting views
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
  { href: "/products", label: "Warranties", icon: ShieldCheck, group: "modules" },
  { href: "/documents", label: "Documents", icon: Files, group: "tools" },
  { href: "/assistant", label: "Assistant", icon: Bot, group: "tools" },
  { href: "/calendar", label: "Upcoming", icon: CalendarDays, group: "tools" },
  { href: "/spend", label: "Spending", icon: TrendingUp, group: "tools" },
];

// Always shown below the module and tool groups, in every nav (Sidebar,
// BottomNav's More sheet). Settings is two separate screens: My account
// (only your own account) and Household settings (shared by everyone).
export const FOOTER_NAV = {
  settings: { href: SETTINGS_ROUTES.settings.href, label: SETTINGS_ROUTES.settings.label, icon: UserRound },
  household: { href: SETTINGS_ROUTES.household.href, label: SETTINGS_ROUTES.household.label, icon: House },
  help: { href: "/help", label: "Help", icon: HelpCircle },
} as const satisfies Record<string, Omit<NavItem, "group">>;

export type FooterNavKey = keyof typeof FOOTER_NAV;

/** The footer entries in the order every nav shows them. */
export const FOOTER_NAV_KEYS: FooterNavKey[] = ["settings", "household", "help"];

/**
 * Whether a footer entry is the current page. /settings/household and its
 * sub-pages also start with /settings, so the two Settings entries go by
 * settingsArea() rather than by prefix.
 */
export function isFooterNavActive(key: FooterNavKey, pathname: string): boolean {
  if (key === "settings") return settingsArea(pathname) === "account";
  if (key === "household") return settingsArea(pathname) === "household";
  const { href } = FOOTER_NAV[key];
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Labels are fixed English strings, so pin the collation: a bare
// localeCompare follows the server's LANG and the browser's locale, which can
// disagree and reorder the nav on hydration.
export const navLabelCollator = new Intl.Collator("en");
export const compareLabels = navLabelCollator.compare;

export function getNavItems(enabledModules: Set<ModuleKey>, chatConfigured: boolean): NavItem[] {
  const optionalModuleItems = Object.values(MODULE_REGISTRY)
    .filter((module) => enabledModules.has(module.key))
    .map(({ href, label, icon }): NavItem => ({ href, label, icon, group: "modules" }));
  const moduleItems = [...BASE_NAV_ITEMS.filter((item) => item.group === "modules"), ...optionalModuleItems].sort((a, b) =>
    compareLabels(a.label, b.label),
  );

  return [
    ...BASE_NAV_ITEMS.filter((item) => item.group === "dashboard"),
    ...moduleItems,
    ...BASE_NAV_ITEMS.filter((item) => item.group === "tools"),
  ].filter(
    (item) => item.href !== "/assistant" || chatConfigured,
  );
}
