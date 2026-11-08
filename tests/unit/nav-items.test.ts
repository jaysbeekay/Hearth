import { describe, expect, it } from "vitest";
import { getNavItems } from "@/components/nav-items";
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
});
