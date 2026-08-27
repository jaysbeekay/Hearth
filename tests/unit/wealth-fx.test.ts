import { describe, expect, it } from "vitest";
import { convertAmount } from "@/lib/fx";
import { holdingUnitsAndCost } from "@/lib/wealth";

type Trade = { type: string; units: number; pricePerUnit: number; fees: number | null };
const trade = (type: string, units: number, pricePerUnit = 0, fees: number | null = null): Trade => ({ type, units, pricePerUnit, fees });

describe("holdingUnitsAndCost", () => {
  it("computes average cost across buys and fees", () => {
    expect(holdingUnitsAndCost([trade("BUY", 10, 10, 5), trade("BUY", 10, 20, 5)], "AVERAGE")).toEqual({ units: 20, cost: 310 });
  });

  it("reduces a partial sale at the holding average cost", () => {
    expect(holdingUnitsAndCost([trade("BUY", 10, 10), trade("BUY", 10, 20), trade("SELL", 5)], "AVERAGE")).toEqual({ units: 15, cost: 225 });
  });

  it("caps an oversell at the units held", () => {
    expect(holdingUnitsAndCost([trade("BUY", 3, 10), trade("SELL", 9)], "AVERAGE")).toEqual({ units: 0, cost: 0 });
  });

  it("adds split units without changing cost and ignores dividends", () => {
    expect(holdingUnitsAndCost([trade("BUY", 2, 10), trade("SPLIT", 4), trade("DIVIDEND", 0)], "AVERAGE")).toEqual({ units: 6, cost: 20 });
  });
});

describe("convertAmount", () => {
  it("returns same-currency amounts without a rate", () => {
    expect(convertAmount(12.5, "AUD", "AUD", new Map())).toBe(12.5);
  });

  it("uses a cached conversion rate", () => {
    expect(convertAmount(100, "USD", "AUD", new Map([["USD_AUD", 1.5]]))).toBe(150);
  });

  it("returns null when the requested rate is missing", () => {
    expect(convertAmount(100, "USD", "AUD", new Map())).toBeNull();
  });
});
