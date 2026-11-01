import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeThresholds, presetFor, thresholdsHint } from "@/components/ReminderThresholdsField";
import { reminderSummary } from "@/lib/notifications/reminderSummary";
import type { ReminderHealth } from "@/lib/notifications/health";

// #360 — Reminder thresholds as presets, and the one-line health card.

describe("presetFor", () => {
  it("reads blank as the household default, 7 and 1 as their presets", () => {
    expect(presetFor("")).toBe("default");
    expect(presetFor(null)).toBe("default");
    expect(presetFor("  ")).toBe("default");
    expect(presetFor("7")).toBe("week");
    expect(presetFor("1")).toBe("day");
  });

  it("keeps every other stored value as Custom, so it round-trips unchanged", () => {
    expect(presetFor("30,14,7,1")).toBe("custom");
    expect(presetFor("60, 30")).toBe("custom");
    expect(presetFor("7,1")).toBe("custom");
  });
});

describe("thresholdsHint", () => {
  it("shows the household default when the record has none of its own", () => {
    expect(thresholdsHint("", "30,14,7,1", "the end date")).toBe(
      "Reminders 30, 14, 7 and 1 days before the end date · shows in Needs attention from 30 days out.",
    );
  });

  it("shows the record's own thresholds and the due-soon window they set", () => {
    expect(thresholdsHint("7", "30,14,7,1", "the date")).toBe(
      "Reminders 7 days before the date · shows in Needs attention from 7 days out.",
    );
    expect(thresholdsHint("1", "30,14,7,1", "the date")).toBe(
      "Reminders 1 day before the date · shows in Needs attention from 1 day out.",
    );
  });

  it("words a single threshold and a list", () => {
    expect(describeThresholds([1])).toBe("1 day");
    expect(describeThresholds([1, 60, 30])).toBe("60, 30 and 1 days");
  });
});

const base: ReminderHealth = {
  enabled: true,
  onHold: false,
  thresholds: [1, 7, 14, 30],
  nextReminder: { kind: "on", date: new Date("2026-09-20T00:00:00Z") },
  channels: { email: true, ntfy: false, webhook: false },
  deliveryReady: true,
  lastSent: null,
  lastFailure: null,
};

describe("reminderSummary", () => {
  it("says when, how and on which thresholds", () => {
    expect(reminderSummary(base)).toEqual({
      tone: "neutral",
      text: "Next reminder 20 Sep 2026 by email · thresholds 30/14/7/1",
    });
  });

  it("leaves the channel out when none is configured (the card says so once)", () => {
    const health = { ...base, deliveryReady: false, channels: { email: false, ntfy: false, webhook: false } };
    expect(reminderSummary(health).text).toMatch(/^Next reminder .* · thresholds 30\/14\/7\/1$/);
    expect(reminderSummary(health).text).not.toContain(" by ");
  });

  it("puts a pending catch-up, a hold and a failure first", () => {
    expect(reminderSummary({ ...base, nextReminder: { kind: "next-check" } }).text).toBe(
      "Next reminder on the next check by email · thresholds 30/14/7/1",
    );
    expect(reminderSummary({ ...base, onHold: true, enabled: false })).toEqual({
      tone: "warning",
      text: "Reminders are on hold until this record is reviewed.",
    });
    expect(
      reminderSummary({
        ...base,
        lastFailure: { channel: "EMAIL", thresholdDays: 7, sentAt: new Date(), error: "SMTP refused" },
      }),
    ).toEqual({ tone: "danger", text: "The last Reminder failed via email — SMTP refused." });
  });

  it("says when nothing is left to send", () => {
    expect(reminderSummary({ ...base, enabled: false, nextReminder: null }).text).toBe("No Reminders left to send.");
  });
});

describe("Reminder forms", () => {
  const root = path.join(__dirname, "..", "..");
  it.each(["ContractForm", "ProductForm", "VehicleForm", "RentalAgreementForm"])(
    "%s uses the presets, not a free-text thresholds field",
    (form) => {
      const source = readFileSync(path.join(root, "src", "components", `${form}.tsx`), "utf8");
      expect(source).toContain("<ReminderThresholdsField");
      expect(source).not.toMatch(/<input[^>]*id="reminderDaysBefore"/);
    },
  );
});
