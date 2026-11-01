import { describe, expect, it } from "vitest";
import { findCost } from "@/lib/documents/textHeuristics";

// The mobile shell's scanCost (ios-shell/www/app.js) is a hand port of this
// pattern; keep the two in step.
describe("findCost", () => {
  it.each([
    ["Premium $999", "999"],
    ["Total $1000", "1000"],
    ["Annual premium $1234.50", "1234.50"],
    ["Amount due AUD 12345.00", "12345.00"],
    ["Total $1,234.50", "1234.50"],
    ["Total EUR 1,000,000.00", "1000000.00"],
  ])("reads the whole amount in %j", (text, expected) => {
    expect(findCost(text)).toBe(expected);
  });

  it.each(["Total $1,23", "Total $12.345"])("rejects a malformed amount instead of a partial one: %j", (text) => {
    expect(findCost(text)).toBeUndefined();
  });

  it("prefers a total line over an earlier amount", () => {
    expect(findCost("Item $20\nTotal $1500")).toBe("1500");
  });
});
