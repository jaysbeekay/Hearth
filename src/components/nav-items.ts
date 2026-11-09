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

// Always shown below the module and tool groups. Settings is two separate
// screens: My account (only your own account) and Household settings
// (shared by everyone). The phone's More sheet lists all three; the desktop
// sidebar puts the two Settings screens in its account menu, with Help as
// the icon beside it.
export const FOOTER_NAV = {
  settings: { key: "settings", href: SETTINGS_ROUTES.settings.href, label: SETTINGS_ROUTES.settings.label, icon: UserRound },
  household: {
    key: "household",
    href: SETTINGS_ROUTES.household.href,
    label: SETTINGS_ROUTES.household.label,
    icon: House,
  },
  help: { key: "help", href: "/help", label: "Help", icon: HelpCircle },
} as const satisfies Record<string, Omit<NavItem, "group"> & { key: string }>;

export type FooterNavKey = keyof typeof FOOTER_NAV;
export type FooterNavEntry = (typeof FOOTER_NAV)[FooterNavKey];

/** The footer entries in the order every nav shows them. */
export const FOOTER_NAV_ENTRIES: readonly FooterNavEntry[] = [FOOTER_NAV.settings, FOOTER_NAV.household, FOOTER_NAV.help];

/** The two Settings screens, in the order the account menu lists them. */
export const SETTINGS_NAV_ENTRIES: readonly FooterNavEntry[] = [FOOTER_NAV.settings, FOOTER_NAV.household];

/**
 * Whether a footer entry is the current page. /settings/household and its
 * sub-pages also start with /settings, so the two Settings entries go by
 * settingsArea() rather than by prefix.
 */
export function isFooterNavActive(key: FooterNavKey, pathname: string): boolean {
  switch (key) {
    case "settings":
      return settingsArea(pathname) === "account";
    case "household":
      return settingsArea(pathname) === "household";
    case "help":
      return pathname === FOOTER_NAV.help.href || pathname.startsWith(`${FOOTER_NAV.help.href}/`);
  }
}

// Labels are fixed English strings, so pin the collation: a bare
// localeCompare follows the server's LANG and the browser's locale, which can
// disagree and reorder the nav on hydration.
export const navLabelCollator = new Intl.Collator("en");
export const compareLabels = navLabelCollator.compare;

/**
 * aria-current for a footer entry, with navCurrent's values (#558): "page" on
 * the entry's own page, "true" on a page below it. The two Settings screens
 * go by settingsArea(), so My account isn't marked on Household settings
 * pages, which also start with /settings.
 */
export function footerNavCurrent(entry: FooterNavEntry, pathname: string): "page" | "true" | undefined {
  if (!isFooterNavActive(entry.key, pathname)) return undefined;
  return pathname === entry.href ? "page" : "true";
}

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
