import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ReminderThresholdsField,
  describeThresholds,
  hasOwnThresholds,
  presetFor,
  thresholdsHint,
} from "@/components/ReminderThresholdsField";
import { reminderThresholds } from "@/lib/notifications/reminderSchedule";
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

describe("hasOwnThresholds (#361)", () => {
  it("reads a stored copy of the household default as the default", () => {
    expect(hasOwnThresholds("", "30,14,7,1")).toBe(false);
    expect(hasOwnThresholds(null, "30,14,7,1")).toBe(false);
    expect(hasOwnThresholds("30,14,7,1", "30,14,7,1")).toBe(false);
    expect(hasOwnThresholds("1, 7,14 ,30", "30,14,7,1")).toBe(false);
  });

  it("spots a record's own thresholds", () => {
    expect(hasOwnThresholds("7", "30,14,7,1")).toBe(true);
    expect(hasOwnThresholds("60,30", "30,14,7,1")).toBe(true);
    expect(hasOwnThresholds("30,14,7,1", "14,7")).toBe(true);
  });
});

describe("thresholdsHint", () => {
  it("agrees with the scheduler when a custom value has no whole days (#516 review)", () => {
    // "1.5" is valid input but holds no whole day, so the household default applies.
    expect(reminderThresholds("1.5", "30,14,7,1")).toEqual([1, 7, 14, 30]);
    expect(thresholdsHint("1.5", "30,14,7,1", "the date")).toBe(
      "Reminders 30, 14, 7 and 1 days before the date · shows in Needs attention from 30 days out.",
    );
  });

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
  snoozedUntil: null,
  thresholds: [1, 7, 14, 30],
  nextReminder: { kind: "on", date: new Date("2026-09-20T00:00:00Z"), by: ["EMAIL"] },
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

  it("names only the channels sending the next one (#516 review)", () => {
    const both = { ...base, channels: { email: true, ntfy: true, webhook: false } };
    expect(reminderSummary({ ...both, nextReminder: { ...base.nextReminder!, by: ["NTFY"] } }).text).toBe(
      "Next reminder 20 Sep 2026 by ntfy · thresholds 30/14/7/1",
    );
    expect(reminderSummary({ ...both, nextReminder: { ...base.nextReminder!, by: ["EMAIL", "NTFY"] } }).text).toBe(
      "Next reminder 20 Sep 2026 by email + ntfy · thresholds 30/14/7/1",
    );
  });

  it("leaves the channel out when none is configured (the card says so once)", () => {
    const health = { ...base, deliveryReady: false, channels: { email: false, ntfy: false, webhook: false } };
    expect(reminderSummary(health).text).toMatch(/^Next reminder .* · thresholds 30\/14\/7\/1$/);
    expect(reminderSummary(health).text).not.toContain(" by ");
  });

  it("puts a pending catch-up, a hold and a failure first", () => {
    expect(reminderSummary({ ...base, nextReminder: { kind: "next-check", by: ["EMAIL"] } }).text).toBe(
      "Next reminder on the next check by email · thresholds 30/14/7/1",
    );
    expect(reminderSummary({ ...base, onHold: true, enabled: false })).toEqual({
      tone: "warning",
      text: "Reminders are on hold until this record is reviewed.",
    });
    // #354
    expect(
      reminderSummary({ ...base, snoozedUntil: new Date("2026-12-03T00:00:00Z"), enabled: false, nextReminder: null }),
    ).toEqual({ tone: "neutral", text: "Snoozed: reminders resume on 3 Dec 2026." });
    expect(
      reminderSummary({
        ...base,
        lastFailure: { channel: "EMAIL", thresholdDays: 7, sentAt: new Date(), error: "SMTP refused" },
      }),
    ).toEqual({ tone: "danger", text: "The last Reminder failed via email — SMTP refused." });
  });

  it("tells apart no thresholds, no scheduled Reminder and all sent (#516 review)", () => {
    // A future date with no thresholds has no coverage: a warning, not "all done".
    expect(reminderSummary({ ...base, thresholds: [], enabled: false, nextReminder: null })).toEqual({
      tone: "warning",
      text: "No Reminder thresholds are set, so no Reminders will be sent.",
    });
    // No Reminder entry (the date has passed, or nothing to remind of).
    expect(reminderSummary({ ...base, enabled: false, nextReminder: null }).text).toBe(
      "No Reminder is scheduled for this date.",
    );
    // Every threshold for this date has gone out.
    expect(
      reminderSummary({
        ...base,
        nextReminder: null,
        lastSent: { channel: "EMAIL", thresholdDays: 1, sentAt: new Date() },
      }).text,
    ).toBe("All Reminders for this date have been sent · thresholds 30/14/7/1");
    // Thresholds passed with nothing sent (e.g. no channel at the time).
    expect(reminderSummary({ ...base, nextReminder: null }).text).toBe(
      "No more Reminders for this date · thresholds 30/14/7/1",
    );
  });
});

describe("Reminder forms", () => {
  const root = path.join(__dirname, "..", "..");
  it.each(["ContractForm", "ProductForm", "VehicleForm", "RentalAgreementForm"])(
    "%s uses the presets, not a free-text thresholds field",
    (form) => {
      const source = readFileSync(path.join(root, "src", "components", `${form}.tsx`), "utf8");
      // The record's stored value goes in, so it round-trips, and the
      // household default goes in, so the hint can show it (#516 review).
      expect(source).toMatch(
        /<ReminderThresholdsField\s+defaultValue=\{[^}]*\??\.reminderDaysBefore \?\? ""\}\s+householdDefault=\{defaultReminderDays\}/,
      );
      expect(source).not.toMatch(/<input[^>]*id="reminderDaysBefore"/);
    },
  );
});

describe("ReminderThresholdsField as rendered (#516 review)", () => {
  const render = (defaultValue: string) =>
    renderToStaticMarkup(createElement(ReminderThresholdsField, { defaultValue, householdDefault: "30,14,7,1" }));
  const submitted = (html: string) => /name="reminderDaysBefore" value="([^"]*)"/.exec(html)?.[1];

  it("submits a stored custom value exactly as it was stored", () => {
    for (const stored of ["60, 30", "30,14,7", "0", "1.5"]) {
      expect(submitted(render(stored))).toBe(stored);
    }
  });

  it("submits the presets' values, and nothing of its own for the default", () => {
    expect(submitted(render("7"))).toBe("7");
    expect(submitted(render("1"))).toBe("1");
    expect(submitted(render(""))).toBe("");
    // A stored copy of the household default reads, and saves, as the default.
    expect(submitted(render("1,7,14,30"))).toBe("");
  });

  it("shows the household default's thresholds in its hint when the record has none", () => {
    expect(render("")).toContain("Reminders 30, 14, 7 and 1 days before the date");
  });
});
