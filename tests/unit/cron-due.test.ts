import { describe, expect, it } from "vitest";
import { cronDue } from "@/lib/jobs/cronDue";

describe("cronDue (#250)", () => {
  it("matches a pattern against a point in time without needing a running timer", () => {
    expect(cronDue("0 8 * * *", new Date(2026, 7, 27, 8, 0, 0))).toBe(true);
    expect(cronDue("0 8 * * *", new Date(2026, 7, 27, 8, 1, 0))).toBe(false);
    expect(cronDue("0 8 * * *", new Date(2026, 7, 27, 9, 0, 0))).toBe(false);
  });

  it("re-evaluates against whatever pattern is passed in, not a cached one", () => {
    const at = new Date(2026, 7, 27, 3, 0, 0);
    expect(cronDue("0 3 * * *", at)).toBe(true);
    // A different pattern checked against the same instant reflects the
    // *new* value immediately — this is the whole point: no restart needed
    // to pick up a schedule changed in Settings.
    expect(cronDue("0 9 * * *", at)).toBe(false);
  });

  it("returns false for an invalid pattern instead of throwing", () => {
    expect(cronDue("not a cron pattern", new Date())).toBe(false);
  });
});
