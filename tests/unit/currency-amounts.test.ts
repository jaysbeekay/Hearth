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
    ["Total € 1 234,56", "1234.56"],
    ["Total €1 234,56", "1234.56"],
    ["Total $1,234,567.89", "1234567.89"],
    ["Total €1.234.567,89", "1234567.89"],
  ])("%s → %s", (text, expected) => {
    expect(findCost(text)).toBe(expected);
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
