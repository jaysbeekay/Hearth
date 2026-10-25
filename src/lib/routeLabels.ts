// #362 — the user-facing name of every Settings page and Documents tab, in
// one place. Each page's <h1>, its metadata.title, the link that opens it
// and the BackLink that returns to it all use the label here, and Help's
// FAQ paths ("Settings → Household & System → Modules") are checked against
// it (tests/unit/help-faq-labels.test.ts). Top-level pages take their names
// from nav-items.ts instead.

export interface SettingsRoute {
  href: string;
  label: string;
  /** The page one level up, which its BackLink returns to. */
  parent: string | null;
}

export const SETTINGS_ROUTES = {
  settings: { href: "/settings", label: "Settings", parent: null },
  household: { href: "/settings/household", label: "Household & System", parent: "/settings" },
  users: { href: "/settings/users", label: "Household members", parent: "/settings/household" },
  backups: { href: "/settings/backups", label: "Backups", parent: "/settings/household" },
  webhooks: { href: "/settings/webhooks", label: "Webhooks", parent: "/settings/household" },
  modules: { href: "/settings/modules", label: "Modules", parent: "/settings/household" },
  app: { href: "/settings/app", label: "System settings", parent: "/settings/household" },
  passkeys: { href: "/settings/passkeys", label: "Passkeys", parent: "/settings" },
  security: { href: "/settings/security", label: "Security log", parent: "/settings" },
  trash: { href: "/settings/trash", label: "Trash", parent: "/settings" },
} as const satisfies Record<string, SettingsRoute>;

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
