// #362 — the user-facing name of every Settings page and Documents tab, in
// one place. Each page's <h1>, its metadata.title, the link that opens it
// and the BackLink that returns to it all use the label here, and Help's
// FAQ paths ("Household settings → Modules") are checked against
// it (tests/unit/help-faq-labels.test.ts). Top-level pages take their names
// from nav-items.ts instead.

export interface SettingsRoute {
  href: string;
  label: string;
  /** The page one level up, which its BackLink returns to. */
  parent: string | null;
}

export const SETTINGS_ROUTES = {
  // Settings is two separate screens, each with its own nav entry: My account
  // (/settings, only your own account) and Household settings (shared by the
  // whole household). Every other page sits under one of them; /settings/app
  // and /settings/webhooks only redirect now.
  settings: { href: "/settings", label: "My account", parent: null },
  household: { href: "/settings/household", label: "Household settings", parent: null },
  passkeys: { href: "/settings/passkeys", label: "Passkeys", parent: "/settings" },
  users: { href: "/settings/users", label: "Members", parent: "/settings/household" },
  modules: { href: "/settings/modules", label: "Modules", parent: "/settings/household" },
  reminders: { href: "/settings/reminders", label: "Reminders & channels", parent: "/settings/household" },
  ai: { href: "/settings/ai", label: "AI & privacy", parent: "/settings/household" },
  ingestion: { href: "/settings/ingestion", label: "Document ingestion", parent: "/settings/household" },
  integrations: { href: "/settings/integrations", label: "Integrations", parent: "/settings/household" },
  backups: { href: "/settings/backups", label: "Backups", parent: "/settings/household" },
  security: { href: "/settings/security", label: "Security log", parent: "/settings/household" },
  trash: { href: "/settings/trash", label: "Recently deleted", parent: "/settings/household" },
} as const satisfies Record<string, SettingsRoute>;

/**
 * Which of the two settings screens a path belongs to: "account" for My
 * account and its sub-pages, "household" for Household settings and its
 * sub-pages, null outside Settings. The nav uses it to mark the right entry
 * active, since /settings/household also starts with /settings.
 */
export function settingsArea(pathname: string): "account" | "household" | null {
  const routes: SettingsRoute[] = Object.values(SETTINGS_ROUTES);
  // Longest href first, so /settings/household wins over /settings.
  const route = routes
    .filter((r) => pathname === r.href || pathname.startsWith(`${r.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (!route) return null;
  const root = route.parent ?? route.href;
  return root === SETTINGS_ROUTES.household.href ? "household" : "account";
}

/** BackLink props for a Settings sub-page: its parent page's href and label. */
export function settingsBackLink(route: SettingsRoute): { href: string; label: string } {
  const routes: SettingsRoute[] = Object.values(SETTINGS_ROUTES);
  const parent = routes.find((r) => r.href === route.parent) ?? SETTINGS_ROUTES.settings;
  return { href: parent.href, label: parent.label };
}

export const DOCUMENTS_TABS = {
  inbox: { href: "/documents/inbox", label: "Inbox" },
  filed: { href: "/documents", label: "Filed" },
  all: { href: "/documents?view=all", label: "All" },
  imports: { href: "/documents/imports", label: "Imports" },
} as const;
