import { describe, expect, it } from "vitest";
import { nextTwelveMonthsSpend, timelineIsFlat } from "@/lib/spend";

// #367 — "Next 12 months" counts a contract that won't renew by itself only
// up to its end date, instead of monthly × 12.
const NOW = new Date(Date.UTC(2026, 10, 2));
const rates = new Map<string, number>();
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

function contract(overrides: Partial<Parameters<typeof nextTwelveMonthsSpend>[0][number]> = {}) {
  return {
    cost: 100,
    currency: "AUD",
    billingFrequency: "MONTHLY",
    startDate: null,
    endDate: null,
    renewalType: "MANUAL_RENEWAL",
    ...overrides,
  };
}

describe("nextTwelveMonthsSpend", () => {
  it("runs a contract with no end date, or one that auto-renews, all year", () => {
    expect(nextTwelveMonthsSpend([contract()], "AUD", rates, NOW)).toBeCloseTo(1200, 6);
    expect(
      nextTwelveMonthsSpend([contract({ endDate: day("2026-12-01"), renewalType: "AUTO_RENEW" })], "AUD", rates, NOW),
    ).toBeCloseTo(1200, 6);
  });

  it("stops a fixed-term or manually renewed contract at its end date", () => {
    // Through 1 Feb 2027: 92 days of the year.
    const fixed = nextTwelveMonthsSpend([contract({ endDate: day("2027-02-01"), renewalType: "FIXED_TERM" })], "AUD", rates, NOW);
    expect(fixed).toBeCloseTo((1200 * 92) / 365, 6);
    const manual = nextTwelveMonthsSpend([contract({ endDate: day("2027-02-01") })], "AUD", rates, NOW);
    expect(manual).toBeCloseTo(fixed, 6);
  });

  it("counts nothing for an ended contract, from the start for a future one", () => {
    expect(nextTwelveMonthsSpend([contract({ endDate: day("2026-10-01") })], "AUD", rates, NOW)).toBe(0);
    // Starts 2 Aug 2027: 92 days before the year is out.
    expect(nextTwelveMonthsSpend([contract({ startDate: day("2027-08-02") })], "AUD", rates, NOW)).toBeCloseTo(
      (1200 * 92) / 365,
      6,
    );
  });

  it("leaves out a cost with no billing frequency, a one-off, and an unconvertible currency", () => {
    expect(
      nextTwelveMonthsSpend(
        [contract({ billingFrequency: null }), contract({ billingFrequency: "ONE_OFF" }), contract({ currency: "XYZ" })],
        "AUD",
        rates,
        NOW,
      ),
    ).toBe(0);
  });
});

describe("timelineIsFlat", () => {
  it("is flat when every bucket matches, to the cent", () => {
    expect(timelineIsFlat([{ total: 50 }, { total: 50.001 }, { total: 50 }])).toBe(true);
    expect(timelineIsFlat([{ total: 50 }, { total: 60 }])).toBe(false);
  });
});
