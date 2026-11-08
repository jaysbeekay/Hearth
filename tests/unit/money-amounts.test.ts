import { describe, expect, it } from "vitest";
import { moneyInputValue } from "@/lib/utils";
import { findCost } from "@/lib/documents/textHeuristics";
import { heuristicExtract as extractLease, normaliseFields } from "@/lib/documents/leaseAgreementExtraction";
import { heuristicExtract as extractRentalStatement } from "@/lib/documents/rentalStatementExtraction";
import { fieldToInputValue } from "@/lib/documents/extractionReview";

describe("moneyInputValue", () => {
  it("keeps two decimals on a saved amount", () => {
    expect(moneyInputValue(510.1)).toBe("510.10");
    expect(moneyInputValue(650)).toBe("650.00");
    expect(moneyInputValue(0.1 + 0.2)).toBe("0.30");
  });

  it("leaves a missing amount blank", () => {
    expect(moneyInputValue(null)).toBe("");
    expect(moneyInputValue(undefined)).toBe("");
  });
});

describe("findCost", () => {
  it("reads amounts with and without a thousands separator", () => {
    expect(findCost("Total premium $510.10")).toBe("510.10");
    expect(findCost("Premium $5,101.00")).toBe("5101.00");
    expect(findCost("Total $5101.00")).toBe("5101.00");
    expect(findCost("Amount payable AUD 12500")).toBe("12500");
  });
});

describe("lease amounts", () => {
  it("reads rent and bond with and without a thousands separator", () => {
    expect(normaliseFields(extractLease("Weekly rent $1200.00\nBond amount $4800"))).toMatchObject({
      weeklyRent: "1200.00",
      bondAmount: "4800",
    });
    expect(normaliseFields(extractLease("Weekly rent $1,200.00\nBond amount $4,800"))).toMatchObject({
      weeklyRent: "1200.00",
      bondAmount: "4800",
    });
  });
});

describe("rental statement amounts", () => {
  it("strips thousands separators from labelled amounts", () => {
    expect(extractRentalStatement("Gross rent $2,600.00\nManagement fee $208.00\nNet amount $2,392.00")).toMatchObject({
      grossRent: "2600.00",
      managementFee: "208.00",
      netAmount: "2392.00",
    });
  });

  it("reads amounts without a thousands separator", () => {
    expect(extractRentalStatement("Gross rent $2600.00")).toMatchObject({ grossRent: "2600.00" });
  });
});

describe("review panel money values", () => {
  it("shows a saved cost or price with two decimals", () => {
    expect(fieldToInputValue("cost", 510.1)).toBe("510.10");
    expect(fieldToInputValue("price", 42)).toBe("42.00");
    expect(fieldToInputValue("title", 42)).toBe("42");
    expect(fieldToInputValue("cost", null)).toBe("");
  });
});

describe("rental statement rent label", () => {
  it("doesn't read a Rental Statement number as gross rent", () => {
    expect(extractRentalStatement("Rental Statement #20241108\nRent $2,600.00").grossRent).toBe("2600.00");
  });
});
