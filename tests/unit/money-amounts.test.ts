import { describe, expect, it } from "vitest";
import { moneyInputValue } from "@/lib/utils";
import { findCost } from "@/lib/documents/textHeuristics";

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
