// #362 — the user-facing name of every Settings page and Documents tab, in
// one place. Each page's <h1>, its metadata.title, the link that opens it
// and the BackLink that returns to it all use the label here, and Help's
// FAQ paths ("Settings → Household → Modules") are checked against
// it (tests/unit/help-faq-labels.test.ts). Top-level pages take their names
// from nav-items.ts instead.

export interface SettingsRoute {
  href: string;
  label: string;
  /** The page one level up, which its BackLink returns to. */
  parent: string | null;
}

export const SETTINGS_ROUTES = {
  // #363 — Settings is two tabs: My account (/settings) and Household. Every
  // other page sits under one of them; /settings/app and /settings/webhooks
  // only redirect now.
  settings: { href: "/settings", label: "Settings", parent: null },
  household: { href: "/settings/household", label: "Household", parent: "/settings" },
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

/** The two tabs at the top of Settings. */
export const SETTINGS_TABS = [
  { key: "account", href: "/settings", label: "My account" },
  { key: "household", href: "/settings/household", label: "Household" },
] as const;

export type SettingsTabKey = (typeof SETTINGS_TABS)[number]["key"];

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
} as const;
