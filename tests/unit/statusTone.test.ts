import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dueEntries, type DueState } from "@/lib/duePolicy";
import { statusBannerClass, statusPillClass, statusTextClass, statusTone, type RecordStatus, type StatusTone } from "@/lib/statusTone";

// #412 — one state-to-tone mapping for every status pill and banner: colour
// only for Overdue and Due soon.

const ALL_STATUSES: RecordStatus[] = [
  "later",
  "due-soon",
  "overdue",
  "ended",
  "lapsed",
  "needs-new-end-date",
  "cancelled",
  "needs-review",
  "housekeeping",
  "no-date",
];
const TONES: StatusTone[] = ["danger", "warning", "neutral", "plain"];

describe("statusTone", () => {
  it.each<[RecordStatus, StatusTone]>([
    ["overdue", "danger"],
    ["due-soon", "warning"],
    ["later", "plain"],
    ["ended", "neutral"],
    ["lapsed", "neutral"],
    ["needs-new-end-date", "neutral"],
    ["cancelled", "neutral"],
    ["needs-review", "neutral"],
    ["housekeeping", "neutral"],
    ["no-date", "neutral"],
  ])("%s is %s", (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });

  it("colours only Overdue and Due soon", () => {
    const coloured = ALL_STATUSES.filter((s) => ["danger", "warning"].includes(statusTone(s)));
    expect(coloured.sort()).toEqual(["due-soon", "overdue"]);
  });

  it("gives every state the Due policy produces a tone", () => {
    const today = "2026-10-30";
    const ctx = { today, defaultReminderDays: "30" };
    const states = new Set<DueState>();
    for (const endDate of ["2026-11-05", "2027-06-01", "2026-10-01"]) {
      for (const renewalType of ["MANUAL_RENEWAL", "AUTO_RENEW", "FIXED_TERM"]) {
        const entries = dueEntries(
          { kind: "contract", endDate, noticePeriodDays: null, renewalType, status: "ACTIVE" },
          ctx,
        );
        for (const e of entries) states.add(e.state);
      }
      for (const e of dueEntries({ kind: "warranty", warrantyEndDate: endDate }, ctx)) states.add(e.state);
    }
    expect([...states].sort()).toEqual(["due-soon", "ended", "lapsed", "later", "needs-new-end-date", "overdue"]);
    for (const state of states) expect(TONES).toContain(statusTone(state));
  });
});

describe("status pill and banner classes", () => {
  it("never use success for a status", () => {
    for (const tone of TONES) {
      expect(statusPillClass(tone)).not.toMatch(/success/);
      expect(statusBannerClass(tone)).not.toMatch(/success/);
    }
  });

  it("colours running text only for danger and warning", () => {
    expect(statusTextClass("danger")).toBe("text-danger");
    expect(statusTextClass("warning")).toBe("text-warning");
    expect(statusTextClass("neutral")).toBe("text-muted");
    expect(statusTextClass("plain")).toBe("text-muted");
  });

  it("draws no pill for a later date: plain muted text", () => {
    const plain = statusPillClass("plain");
    expect(plain).toContain("text-muted");
    expect(plain).not.toMatch(/\bbg-/);
  });

  it("tints each coloured pill at 10%, the tint scripts/check-contrast.mjs checks", () => {
    expect(statusPillClass("danger")).toContain("bg-danger/10 text-danger");
    expect(statusPillClass("warning")).toContain("bg-warning/10 text-warning");
    expect(statusPillClass("neutral")).toContain("bg-muted/10 text-muted");
    expect(statusBannerClass("danger")).toContain("bg-danger/10 text-danger");
    expect(statusBannerClass("warning")).toContain("bg-warning/10 text-warning");
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "generated" ? [] : sourceFiles(full);
    return /\.(ts|tsx|css)$/.test(name) ? [full] : [];
  });
}

describe("source", () => {
  const src = path.join(__dirname, "..", "..", "src");
  const files = sourceFiles(src).map((file) => ({ file: path.relative(src, file), text: readFileSync(file, "utf8") }));

  it("uses no Tailwind palette colours, only the theme tokens", () => {
    const palette = /\b(text|bg|border)-(amber|slate|blue|purple|sky|green|orange|red)-/;
    expect(files.filter((f) => palette.test(f.text)).map((f) => f.file)).toEqual([]);
  });

  it("keeps status pills and banners free of success colours", () => {
    const statusComponents = [
      "components/ExpiryBadge.tsx",
      "components/StatusPill.tsx",
      "components/DetailStatusBanner.tsx",
      "components/VehicleCard.tsx",
      "components/NeedsAttentionQueue.tsx",
      "components/ListSummaryStrip.tsx",
      "lib/dueRecords.ts",
    ];
    for (const name of statusComponents) {
      const file = files.find((f) => f.file === name);
      expect(file, name).toBeDefined();
      expect(file!.text, name).not.toMatch(/success/);
    }
  });
});
