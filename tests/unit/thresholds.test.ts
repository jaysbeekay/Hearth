import { describe, expect, it } from "vitest";
import { parseThresholds } from "@/lib/notifications/thresholds";

describe("parseThresholds", () => {
  it("uses the default thresholds for empty input", () => {
    expect(parseThresholds(null)).toEqual([1, 7, 14, 30]);
    expect(parseThresholds("   ")).toEqual([1, 7, 14, 30]);
  });

  it("parses, filters, deduplicates, and sorts values", () => {
    expect(parseThresholds("14, 7, nope, -1, 7, 0, Infinity, 30")).toEqual([0, 7, 14, 30]);
  });

  it("supports a custom default", () => {
    expect(parseThresholds(undefined, "10,5")).toEqual([5, 10]);
  });
});
