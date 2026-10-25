import { describe, expect, it } from "vitest";
import { checkContrast, readGlobalsCss } from "../../scripts/check-contrast.mjs";

// #408: every text token pairing in globals.css stays >= 4.5:1 and borders
// stay visible (>= 1.4:1), in both themes.
describe("colour token contrast", () => {
  const rows = checkContrast(readGlobalsCss());

  it("checks both themes", () => {
    expect(new Set(rows.map((r) => r.theme))).toEqual(new Set(["light", "dark"]));
  });

  it.each(rows.map((r) => [`${r.theme}: ${r.pair}`, r] as const))("%s", (_name, row) => {
    expect(row.ratio).toBeGreaterThanOrEqual(row.min);
  });
});
