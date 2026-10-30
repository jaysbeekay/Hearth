import { describe, expect, it } from "vitest";
import {
  addMonths,
  billingFrequencyText,
  formatTermCost,
  formatTermCostChange,
  nextTermDates,
  pickTermDocument,
  termCostChange,
} from "@/lib/contractTerms";

describe("nextTermDates (#353)", () => {
  it("starts the day after the current end date and keeps a whole-month length", () => {
    expect(nextTermDates({ startDate: "2025-07-01", endDate: "2026-06-30" })).toEqual({
      startDate: "2026-07-01",
      endDate: "2027-06-30",
    });
    // Across a leap day, a year is still a year.
    expect(nextTermDates({ startDate: "2027-03-01", endDate: "2028-02-29" })).toEqual({
      startDate: "2028-03-01",
      endDate: "2029-02-28",
    });
    expect(nextTermDates({ startDate: new Date("2026-01-15T00:00:00Z"), endDate: new Date("2026-04-14T00:00:00Z") })).toEqual({
      startDate: "2026-04-15",
      endDate: "2026-07-14",
    });
  });

  it("keeps any other length in days", () => {
    expect(nextTermDates({ startDate: "2026-01-01", endDate: "2026-01-28" })).toEqual({
      startDate: "2026-01-29",
      endDate: "2026-02-25",
    });
  });

  it("assumes a year with no start date to measure from", () => {
    expect(nextTermDates({ startDate: null, endDate: "2026-06-30" })).toEqual({
      startDate: "2026-07-01",
      endDate: "2027-06-30",
    });
    // A start after the end can't be measured either.
    expect(nextTermDates({ startDate: "2026-08-01", endDate: "2026-06-30" }).endDate).toBe("2027-06-30");
  });

  it("rolls a Contract several Terms late forward to the Term running today", () => {
    // Yearly, last renewed to 30 Jun 2023; today is 15 Mar 2026.
    const late = { startDate: "2022-07-01", endDate: "2023-06-30" };
    expect(nextTermDates(late, { rollForwardTo: "2026-03-15" })).toEqual({
      startDate: "2025-07-01",
      endDate: "2026-06-30",
    });
    // Without rolling forward, it's just the next Term.
    expect(nextTermDates(late).endDate).toBe("2024-06-30");
    // A Term in days rolls by whole Terms too: 28-day Terms from 1 Jan.
    expect(nextTermDates({ startDate: "2026-01-01", endDate: "2026-01-28" }, { rollForwardTo: "2026-03-01" })).toEqual({
      startDate: "2026-02-26",
      endDate: "2026-03-25",
    });
    // An end date already on or after today needs no rolling.
    expect(nextTermDates(late, { rollForwardTo: "2024-06-30" }).endDate).toBe("2024-06-30");
  });

  it("guesses nothing with no end date", () => {
    expect(nextTermDates({ startDate: "2026-01-01", endDate: null })).toEqual({ startDate: null, endDate: null });
  });
});

describe("addMonths", () => {
  it("clamps to the end of a shorter month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
});

describe("termCostChange", () => {
  const annual = (cost: number | null, currency = "AUD", billingFrequency: string | null = "ANNUALLY") => ({
    cost,
    currency,
    billingFrequency,
  });

  it("is the fraction more or less than the previous Term", () => {
    expect(termCostChange(annual(1344), annual(1200))).toBeCloseTo(0.12);
    expect(termCostChange(annual(950), annual(1000))).toBeCloseTo(-0.05);
  });

  it("is null when the two can't be compared", () => {
    expect(termCostChange(annual(100), null)).toBeNull();
    expect(termCostChange(annual(null), annual(100))).toBeNull();
    expect(termCostChange(annual(100), annual(0))).toBeNull();
    expect(termCostChange(annual(100), annual(90, "USD"))).toBeNull();
    expect(termCostChange(annual(100), annual(90, "AUD", "MONTHLY"))).toBeNull();
  });
});

describe("formatting", () => {
  it("formats a change to the nearest whole percent", () => {
    expect(formatTermCostChange(0.12)).toBe("+12% vs prior term");
    expect(formatTermCostChange(-0.05)).toBe("−5% vs prior term");
    expect(formatTermCostChange(0.001)).toBe("Same as prior term");
  });

  it("formats a Term's cost with its billing frequency", () => {
    expect(formatTermCost({ cost: 1200, currency: "AUD", billingFrequency: "ANNUALLY" }, "en-AU")).toBe(
      "$1,200.00 / annually",
    );
    expect(formatTermCost({ cost: 10, currency: "AUD", billingFrequency: null }, "en-AU")).toBe("$10.00");
    expect(formatTermCost({ cost: null, currency: "AUD", billingFrequency: null })).toBe("—");
    expect(billingFrequencyText("NOT_A_FREQUENCY")).toBeNull();
  });
});

describe("pickTermDocument", () => {
  const doc = (id: string, category: string | null, uploadedAt: string) => ({
    id,
    category,
    uploadedAt: new Date(uploadedAt),
  });

  it("prefers a policy or agreement over a newer receipt or claim photo", () => {
    expect(
      pickTermDocument([
        doc("receipt", "RECEIPT", "2026-06-01"),
        doc("policy", "POLICY", "2025-07-01"),
        doc("photo", "PHOTO", "2026-07-01"),
      ]),
    ).toBe("policy");
    expect(
      pickTermDocument([doc("lease", "RENTAL_AGREEMENT", "2025-01-01"), doc("invoice", "INVOICE", "2026-01-01")]),
    ).toBe("lease");
  });

  it("takes the newest within the same kind, and uncategorised before receipts", () => {
    expect(pickTermDocument([doc("old", "POLICY", "2024-07-01"), doc("new", "POLICY", "2025-07-01")])).toBe("new");
    expect(pickTermDocument([doc("receipt", "RECEIPT", "2026-01-01"), doc("plain", null, "2025-01-01")])).toBe("plain");
    expect(pickTermDocument([])).toBeNull();
  });
});
