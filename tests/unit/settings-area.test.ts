import { describe, expect, it } from "vitest";
import { settingsArea } from "@/lib/routeLabels";
import { isFooterNavActive } from "@/components/nav-items";

// My account and Household settings are separate nav entries, but
// /settings/household also starts with /settings: each path must mark
// exactly one of them as current.
describe("settingsArea", () => {
  it.each([
    ["/settings", "account"],
    ["/settings/passkeys", "account"],
    ["/settings/household", "household"],
    ["/settings/users", "household"],
    ["/settings/ai", "household"],
    ["/settings/trash", "household"],
    ["/dashboard", null],
    ["/settingsx", null],
  ])("%s → %s", (path, area) => {
    expect(settingsArea(path)).toBe(area);
  });

  it("marks one footer entry active per settings path", () => {
    expect(isFooterNavActive("settings", "/settings/household")).toBe(false);
    expect(isFooterNavActive("household", "/settings/household")).toBe(true);
    expect(isFooterNavActive("settings", "/settings/passkeys")).toBe(true);
    expect(isFooterNavActive("household", "/settings")).toBe(false);
    expect(isFooterNavActive("help", "/help")).toBe(true);
  });
});
