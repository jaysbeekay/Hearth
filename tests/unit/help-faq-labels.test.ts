import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FAQ_SECTIONS, faqReferences } from "@/lib/help/faq";
import { FOOTER_NAV, getNavItems } from "@/components/nav-items";
import { MODULE_KEYS, MODULE_REGISTRY } from "@/lib/modules/registry";
import { DOCUMENTS_TABS, SETTINGS_ROUTES, type SettingsRoute } from "@/lib/routeLabels";

// #362 — Help's answers may only point at labels that exist: a top-level
// nav label, a module name, a Settings page under its parent, a Documents
// tab, or (as the last step of a Settings path) a section heading on that
// page.

const navItems = getNavItems(new Set(MODULE_KEYS), true);
const TOP_LEVEL = new Map<string, string>([
  ...navItems.map((item): [string, string] => [item.label, item.href]),
  ...Object.values(MODULE_REGISTRY).map((m): [string, string] => [m.label, m.href]),
  ...Object.values(FOOTER_NAV).map((item): [string, string] => [item.label, item.href]),
]);
const settingsRoutes: SettingsRoute[] = Object.values(SETTINGS_ROUTES);

function settingsPageSource(href: string): string {
  const rel = href.replace(/^\/settings/, "settings");
  return readFileSync(path.resolve(__dirname, "../../src/app/(app)", rel, "page.tsx"), "utf8");
}

/** Why a [[path]] doesn't resolve, or null when it does. */
function unresolved(segments: string[]): string | null {
  const [first, ...rest] = segments;
  let href = TOP_LEVEL.get(first);
  if (!href) return `"${first}" is not a nav label`;
  for (const [i, segment] of rest.entries()) {
    const last = i === rest.length - 1;
    if (href === "/documents") {
      if (!Object.values(DOCUMENTS_TABS).some((tab) => tab.label === segment)) return `no Documents tab "${segment}"`;
      href = undefined;
      continue;
    }
    if (href?.startsWith("/settings")) {
      const child = settingsRoutes.find((r) => r.parent === href && r.label === segment);
      if (child) {
        href = child.href;
        continue;
      }
      if (last && settingsPageSource(href).includes(`>${segment}<`)) return null;
      return `no Settings page or section "${segment}" under ${href}`;
    }
    return `"${segment}" follows a page with no sub-pages`;
  }
  return null;
}

describe("Help FAQ labels", () => {
  const entries = FAQ_SECTIONS.flatMap((section) => section.entries);

  it("references only labels that exist", () => {
    const problems = entries.flatMap((entry) =>
      faqReferences(entry.a).flatMap((segments) => {
        const why = unresolved(segments);
        return why ? [`${entry.q}: [[${segments.join(" → ")}]] — ${why}`] : [];
      }),
    );
    expect(problems).toEqual([]);
  });

  it("marks every navigation path as a [[reference]]", () => {
    const unmarked = entries.filter((entry) => entry.a.replace(/\[\[.+?\]\]/g, "").includes("→"));
    expect(unmarked.map((entry) => entry.q)).toEqual([]);
  });

  it("catches a label that doesn't exist", () => {
    expect(unresolved(["Settings", "Users"])).not.toBeNull();
    expect(unresolved(["Purchases & warranties"])).not.toBeNull();
    expect(unresolved(["Settings", "Household & System", "System settings", "No such section"])).not.toBeNull();
    expect(unresolved(["Settings", "Household & System", "System settings", "AI Assistant"])).toBeNull();
  });
});
