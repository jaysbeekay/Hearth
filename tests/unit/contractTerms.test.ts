import { describe, expect, it } from "vitest";
import {
  addMonths,
  billingFrequencyText,
  formatTermCost,
  formatTermCostChange,
  nextTermDates,
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
    expect(formatTermCostChange(0.12)).toBe("+12% vs last term");
    expect(formatTermCostChange(-0.05, "previous")).toBe("−5% vs previous");
    expect(formatTermCostChange(0.001)).toBe("Same as last term");
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
