import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findCost } from "@/lib/documents/textHeuristics";

// The mobile shell's scanCost (ios-shell/www/app.js) is a hand port of
// findCost; the shell has no build step, so its function is lifted out of
// the source and run against the same cases to keep the two in step.
function loadShellScanCost(): (text: string) => string | undefined {
  const source = readFileSync(path.join(__dirname, "../../ios-shell/www/app.js"), "utf8");
  const match = source.match(/^function scanCost\(text\) \{[\s\S]*?^\}$/m);
  if (!match) throw new Error("scanCost not found in ios-shell/www/app.js");
  return new Function(`${match[0]}\nreturn scanCost;`)() as (text: string) => string | undefined;
}

const implementations: Array<[string, (text: string) => string | undefined]> = [
  ["findCost (server)", findCost],
  ["scanCost (mobile shell)", loadShellScanCost()],
];

describe.each(implementations)("%s", (_name, readCost) => {
  it.each([
    ["Premium $999", "999"],
    ["Total $1000", "1000"],
    ["Annual premium $1234.50", "1234.50"],
    ["Amount due AUD 12345.00", "12345.00"],
    ["Total $1,234.50", "1234.50"],
    ["Total EUR 1,000,000.00", "1000000.00"],
  ])("reads the whole amount in %j", (text, expected) => {
    expect(readCost(text)).toBe(expected);
  });

  // Groupings both implementations refuse. ("$1,23" and "$12.345" are no longer
  // here: the server reads them as European amounts, 1.23 and 12345, since #613; the shell still reads only English-format amounts.)
  it.each(["Total $1.234.56", "Total $12,34,567"])("rejects a malformed amount instead of a partial one: %j", (text) => {
    expect(readCost(text)).toBeUndefined();
  });

  it("prefers a total line over an earlier amount", () => {
    expect(readCost("Item $20\nTotal $1500")).toBe("1500");
  });
});
