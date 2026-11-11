import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findCost, parseAmount } from "@/lib/documents/textHeuristics";

// The mobile shell's amount parsing (ios-shell/www/app.js) is a hand port of
// parseAmount and findCost; the shell has no build step, so its block is
// lifted out of the source and run against the server's functions.
type Reader = (text: string) => string | undefined;

function loadShellAmountParsing(): { scanParseAmount: Reader; scanCost: Reader } {
  const source = readFileSync(path.join(__dirname, "../../ios-shell/www/app.js"), "utf8");
  const match = source.match(/^\/\/ --- Amount parsing:[\s\S]*?^\/\/ --- End of amount parsing\.$/m);
  if (!match) throw new Error("amount parsing block not found in ios-shell/www/app.js");
  return new Function(`${match[0]}\nreturn { scanParseAmount, scanCost };`)() as {
    scanParseAmount: Reader;
    scanCost: Reader;
  };
}

const shell = loadShellAmountParsing();

const implementations: Array<[string, Reader]> = [
  ["findCost (server)", findCost],
  ["scanCost (mobile shell)", shell.scanCost],
];

describe.each(implementations)("%s", (_name, readCost) => {
  it.each([
    ["Premium $999", "999"],
    ["Total $1000", "1000"],
    ["Annual premium $1234.50", "1234.50"],
    ["Amount due AUD 12345.00", "12345.00"],
    ["Total $1,234.50", "1234.50"],
    ["Total EUR 1,000,000.00", "1000000.00"],
    ["Total €1.234,56", "1234.56"],
    ["Total R 1 234,56", "1234.56"],
    ["Total ¥12,000", "12000"],
    ["Unit R2 total $500", "500"],
  ])("reads the whole amount in %j", (text, expected) => {
    expect(readCost(text)).toBe(expected);
  });

  it.each(["Total $1,23,456", "Total $1.234.56"])("rejects a malformed amount instead of a partial one: %j", (text) => {
    expect(readCost(text)).toBeUndefined();
  });

  it("prefers a total line over an earlier amount", () => {
    expect(readCost("Item $20\nTotal $1500")).toBe("1500");
  });
});

// Every input the server's amount tests use, plus edge cases: the shell must
// give the same answer as the server for each one.
const parityInputs = [
  "Total £1,234.56", "Total €1.234,56", "Total R 1 234,56", "Total ¥12,000", "Total £5101.00",
  "Total $1.234,56", "Total $ 5 101.00", "AUD 5101.00", "Total USD 12500", "Total JPY 50,000",
  "Total ZAR 1 500,00", "Total GBP 99.99", "Total $1,234,567.89", "Total €1.234.567,89",
  "Total € 1 234,56", "Total €1 234,56", "Total €1 234 per year",
  "Unit R2 total $500", "Section R 12 total $500", "Grade R1 rated, cost $10", "R2 D2",
  "Call R 0412 345 678", "R 0412", "Total R 250,00", "R 2024 01 15", "$50 100 items",
  "Premium $120 365 days cover", "$12 345 678 90", "$ 5 101.00", "Total $ 5 101", "Total $ 5 101.",
  "$1.234.56", "£1,234,56", "$12,34,567", "$\n500", "R\n500", "€1.234", "£1,234", "€12,50",
  "$12.5", "$5101.00", "$12", "¥1,234", "¥12.000", "¥1,234.56", "$0.500", "€0,5", "Ref R2D2",
  "Order R12AB", "Reference number 4471", "Section R of the agreement", "Room R", "BAR 12",
  "Total due", "Ref R2D2 total R 250,00", "$12 2024", "Item $20\nTotal $1500", "",
];

describe("the shell's amount parsing matches the server's", () => {
  it.each(parityInputs)("parseAmount(%j)", (text) => {
    expect(shell.scanParseAmount(text)).toBe(parseAmount(text));
  });

  it.each(parityInputs)("findCost(%j)", (text) => {
    expect(shell.scanCost(text)).toBe(findCost(text));
  });
});
