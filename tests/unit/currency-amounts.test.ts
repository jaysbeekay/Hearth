import { describe, expect, it } from "vitest";
import { findCost, parseAmount } from "@/lib/documents/textHeuristics";
import { heuristicExtract as extractLease, normaliseFields } from "@/lib/documents/leaseAgreementExtraction";
import { heuristicExtract as extractRentalStatement } from "@/lib/documents/rentalStatementExtraction";

describe("findCost reads amounts in other currencies and number styles (#613)", () => {
  it.each([
    ["Total £1,234.56", "1234.56"],
    ["Total €1.234,56", "1234.56"],
    ["Total R 1 234,56", "1234.56"],
    ["Total ¥12,000", "12000"],
    ["Total £5101.00", "5101.00"],
    ["Total $1.234,56", "1234.56"],
    ["Total $ 5 101.00", "5101.00"],
    ["AUD 5101.00", "5101.00"],
    ["Total $1,234.56", "1234.56"],
    ["Total USD 12500", "12500"],
    ["Total JPY 50,000", "50000"],
    ["Total ZAR 1 500,00", "1500.00"],
    ["Total GBP 99.99", "99.99"],
    ["Total $1,234,567.89", "1234567.89"],
    ["Total €1.234.567,89", "1234567.89"],
  ])("%s → %s", (text, expected) => {
    expect(findCost(text)).toBe(expected);
  });
});

describe("findCost reads NBSP / thin-space grouping", () => {
  it.each([
    ["NBSP after the sign, narrow NBSP grouping", "Total \u20AC\u00A01\u202F234,56", "1234.56"],
    ["thin space grouping", "Total \u20AC1\u2009234,56", "1234.56"],
    ["NBSP grouping before a word", "Total \u20AC1\u00A0234 per year", "1234"],
  ])("%s", (_name, text, expected) => {
    expect(findCost(text)).toBe(expected);
  });
});

describe("an R reference before a real amount doesn't win (#632 review)", () => {
  it.each([
    ["Unit R2 total $500", "500"],
    ["Section R 12 total $500", "500"],
    ["Grade R1 rated, cost $10", "10"],
  ])("findCost(%s) → %s", (text, expected) => {
    expect(findCost(text)).toBe(expected);
  });

  it.each(["R2 D2", "Call R 0412 345 678", "R 0412"])("%s → nothing", (text) => {
    expect(parseAmount(text)).toBeUndefined();
  });

  it("still reads an R amount when it's the only one on the line", () => {
    expect(parseAmount("Total R 250,00")).toBe("250.00");
    expect(parseAmount("R 2024 01 15")).toBe("2024");
  });

  it("lease rent and bond skip a unit or section reference", () => {
    expect(normaliseFields(extractLease("Weekly rent for Unit R3: $450 per week\nBond of R 12 total $1,800"))).toMatchObject({
      weeklyRent: "450",
      bondAmount: "1800",
    });
  });

  it("rental statement gross rent skips a property reference", () => {
    expect(extractRentalStatement("Gross rent R1 property $2,600.00").grossRent).toBe("2600.00");
  });
});

describe("plain-space grouping doesn't swallow a following number", () => {
  it.each([
    ["$50 100 items", "50"],
    ["Premium $120 365 days cover", "120"],
    ["$12 345 678 90", "12"],
    ["$ 5 101.00", "5101.00"],
    ["R 1 234,56", "1234.56"],
    ["Total $ 5 101", "5101"],
    ["Total $ 5 101.", "5101"],
  ])("%s → %s", (text, expected) => {
    expect(parseAmount(text)).toBe(expected);
  });
});

describe("parseAmount rejects malformed grouping instead of truncating", () => {
  it.each(["$1.234.56", "£1,234,56", "$12,34,567"])("%s → nothing", (text) => {
    expect(parseAmount(text)).toBeUndefined();
  });
});

describe("parseAmount stays on one line", () => {
  it("doesn't join a sign to a number on the next line", () => {
    expect(parseAmount("$\n500")).toBeUndefined();
    expect(parseAmount("R\n500")).toBeUndefined();
  });
});

describe("parseAmount runs in linear time", () => {
  it.each([
    ["a long digit run", "$" + "1".repeat(10_000)],
    ["long space grouping", "$1" + " 234".repeat(2_500) + "x"],
    ["many signs", "$ ".repeat(5_000)],
    ["many R references", "R1a ".repeat(2_500)],
  ])("%s (10k chars)", (_name, text) => {
    const start = performance.now();
    parseAmount(text);
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe("parseAmount resolves an ambiguous separator", () => {
  it.each([
    ["€1.234", "1234"],
    ["£1,234", "1234"],
    ["€12,50", "12.50"],
    ["$12.5", "12.5"],
    ["$5101.00", "5101.00"],
    ["$12", "12"],
    ["¥1,234", "1234"],
    ["¥12.000", "12000"],
    ["¥1,234.56", "1234"],
    ["$0.500", "0.500"],
    ["€0,5", "0.5"],
  ])("%s → %s", (text, expected) => {
    expect(parseAmount(text)).toBe(expected);
  });
});

describe("parseAmount doesn't read references as amounts", () => {
  it.each([
    "Ref R2D2",
    "Order R12AB",
    "Reference number 4471",
    "Section R of the agreement",
    "Room R",
    "BAR 12",
    "Total due",
  ])("%s → nothing", (text) => {
    expect(parseAmount(text)).toBeUndefined();
  });

  it("still reads a later amount on the same line", () => {
    expect(parseAmount("Ref R2D2 total R 250,00")).toBe("250.00");
  });

  it("doesn't join a following number into a space-grouped amount", () => {
    expect(parseAmount("$12 2024")).toBe("12");
  });
});

describe("lease extractor reads other currencies", () => {
  it("reads £/€/R rent and bond", () => {
    expect(normaliseFields(extractLease("Weekly rent £1,200.00\nBond amount €4.800"))).toMatchObject({
      weeklyRent: "1200.00",
      bondAmount: "4800",
    });
    expect(normaliseFields(extractLease("Weekly rent R 1 200,00\nBond amount R4 800"))).toMatchObject({
      weeklyRent: "1200.00",
      bondAmount: "4800",
    });
  });
});

describe("rental statement extractor reads other currencies", () => {
  it("reads £/€/R labelled amounts", () => {
    expect(
      extractRentalStatement("Gross rent £2,600.00\nManagement fee €208,00\nNet amount R 2 392,00"),
    ).toMatchObject({
      grossRent: "2600.00",
      managementFee: "208.00",
      netAmount: "2392.00",
    });
  });
});
