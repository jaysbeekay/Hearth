import { afterEach, describe, expect, it, vi } from "vitest";
import { getNavItems, navLabelCollator } from "@/components/nav-items";
import { MODULE_KEYS } from "@/lib/modules/registry";

describe("getNavItems", () => {
  it("lists Inventory when it is enabled", () => {
    const hrefs = getNavItems(new Set(["INVENTORY"]), false).map((item) => item.href);
    expect(hrefs).toContain("/inventory");
  });

  it("leaves out disabled modules", () => {
    const hrefs = getNavItems(new Set(), false).map((item) => item.href);
    expect(hrefs).not.toContain("/inventory");
    expect(hrefs).not.toContain("/travel");
  });

  it("lists modules alphabetically between Dashboard and the tools", () => {
    const items = getNavItems(new Set(MODULE_KEYS), true);
    expect(items.map((item) => item.label)).toEqual([
      "Dashboard",
      "Contracts",
      "Inventory",
      "Properties",
      "Travel",
      "Vehicles",
      "Warranties",
      "Wealth",
      "Documents",
      "Assistant",
      "Upcoming",
      "Spending",
    ]);
  });

  describe("sort order does not depend on the runtime locale", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("pins the collator to English", () => {
      expect(navLabelCollator.resolvedOptions().locale).toBe("en");
    });

    it("ignores a default-locale localeCompare that would reorder labels", () => {
      // Stand-in for a server LANG (e.g. haw_US) whose default collation
      // disagrees with English: reverse every comparison.
      const original = String.prototype.localeCompare;
      vi.spyOn(String.prototype, "localeCompare").mockImplementation(function (this: string, that: string) {
        return -original.call(this, that, "en");
      });
      const labels = getNavItems(new Set(MODULE_KEYS), false)
        .filter((item) => item.group === "modules")
        .map((item) => item.label);
      expect(labels).toEqual([...labels].sort(new Intl.Collator("en").compare));
      expect(labels[0]).toBe("Contracts");
    });
  });
});
