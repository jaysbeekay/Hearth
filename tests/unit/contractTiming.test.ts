import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contractTiming, noticeApplies } from "@/lib/contractTiming";

// Back-compat cover for contractTiming's current callers until they move onto
// the Due policy (#384), when this file goes with it. The Due rules
// themselves are pinned in tests/fixtures/due-policy-cases.json.

// Midday UTC, so local-date arithmetic in daysUntil is stable in any test TZ.
const NOW = new Date("2026-10-24T12:00:00.000Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("contractTiming (#351)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("counts to the end date when there is no notice period", () => {
    const t = contractTiming({ endDate: inDays(40), noticePeriodDays: null, renewalType: "AUTO_RENEW" });
    expect(t).toMatchObject({ endDays: 40, cancelBy: null, beforeCancelBy: false, days: 40 });
  });

  it("counts to the notice deadline while it is ahead", () => {
    const t = contractTiming({ endDate: inDays(40), noticePeriodDays: 30, renewalType: "AUTO_RENEW" });
    expect(t.cancelByDays).toBe(10);
    expect(t.beforeCancelBy).toBe(true);
    expect(t.days).toBe(10);
    expect(t.keyDate?.getTime()).toBe(inDays(10).getTime());
  });

  it("treats the deadline day itself as still ahead", () => {
    const t = contractTiming({ endDate: inDays(30), noticePeriodDays: 30, renewalType: "MANUAL_RENEWAL" });
    expect(t).toMatchObject({ cancelByDays: 0, beforeCancelBy: true, days: 0 });
  });

  it("falls back to the end date once the notice deadline has passed", () => {
    const t = contractTiming({ endDate: inDays(5), noticePeriodDays: 30, renewalType: "AUTO_RENEW" });
    expect(t).toMatchObject({ cancelByDays: -25, beforeCancelBy: false, days: 5, endDays: 5 });
  });

  it("ignores the notice period on a fixed-term contract", () => {
    const t = contractTiming({ endDate: inDays(40), noticePeriodDays: 30, renewalType: "FIXED_TERM" });
    expect(t).toMatchObject({ cancelBy: null, days: 40 });
  });

  it("handles a missing end date and serialized dates", () => {
    expect(contractTiming({ endDate: null, noticePeriodDays: 30, renewalType: "AUTO_RENEW" }).days).toBeNull();
    expect(
      contractTiming({ endDate: inDays(40).toISOString(), noticePeriodDays: 30, renewalType: "AUTO_RENEW" }).days,
    ).toBe(10);
  });

  it("noticeApplies needs a positive notice period on a renewing contract", () => {
    expect(noticeApplies({ noticePeriodDays: 0, renewalType: "AUTO_RENEW" })).toBe(false);
    expect(noticeApplies({ noticePeriodDays: 14, renewalType: "MANUAL_RENEWAL" })).toBe(true);
    expect(noticeApplies({ noticePeriodDays: 14, renewalType: "FIXED_TERM" })).toBe(false);
    expect(noticeApplies({ noticePeriodDays: 1.5, renewalType: "AUTO_RENEW" })).toBe(false);
  });
});
