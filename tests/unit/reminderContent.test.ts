import { describe, expect, it } from "vitest";
import {
  buildNtfyReminder,
  buildReminderEmail,
  buildReminderWebhookBody,
  formatReminderDate,
  reminderRecordUrl,
  type ReminderInput,
} from "@/lib/notifications/reminderContent";

const END = new Date("2026-10-20T00:00:00.000Z");

const contract: ReminderInput = {
  kind: "contract",
  id: "c1",
  title: "Home & Contents Insurance",
  detail: "Allianz",
  daysRemaining: 14,
  endDate: END,
  dateFormat: "DD/MM/YYYY",
  appUrl: "https://hearth.example/",
};

describe("reminderRecordUrl (#352)", () => {
  it("links each kind to its own detail page", () => {
    expect(reminderRecordUrl("https://h.example", "contract", "a")).toBe("https://h.example/contracts/a");
    expect(reminderRecordUrl("https://h.example/", "warranty", "b")).toBe("https://h.example/products/b");
    expect(reminderRecordUrl("https://h.example", "vehicle", "c")).toBe("https://h.example/vehicles/c");
  });

  it("returns null when APP_URL isn't configured", () => {
    expect(reminderRecordUrl(null, "contract", "a")).toBeNull();
    expect(reminderRecordUrl("", "contract", "a")).toBeNull();
  });
});

describe("formatReminderDate (#352)", () => {
  it.each([
    ["DD/MM/YYYY", "20 October 2026"],
    ["MM/DD/YYYY", "October 20, 2026"],
    ["YYYY-MM-DD", "2026-10-20"],
    [null, "20 October 2026"],
  ])("formats %s as %s", (format, expected) => {
    expect(formatReminderDate(END, format)).toBe(expected);
  });
});

describe("buildReminderEmail (#352)", () => {
  it("includes a link to the record, in the user's date format", () => {
    const email = buildReminderEmail({ ...contract, dateFormat: "MM/DD/YYYY" });
    expect(email.subject).toBe('Reminder: "Home & Contents Insurance" contract expires in 14 days');
    expect(email.text).toContain(
      'Your contract "Home & Contents Insurance" (Allianz) expires on October 20, 2026 (in 14 days).',
    );
    expect(email.text).toContain("Open it in Hearth: https://hearth.example/contracts/c1");
    expect(email.html).toContain('<a href="https://hearth.example/contracts/c1">Open it in Hearth</a>');
    expect(email.html).toContain("<strong>Home &amp; Contents Insurance</strong>");
  });

  it("falls back to plain instructions without APP_URL", () => {
    const email = buildReminderEmail({ ...contract, appUrl: null });
    expect(email.text).toContain("Log in to Hearth to review it.");
    expect(email.html).not.toContain("<a ");
  });

  it("names vehicle reminders by what is due, not as a contract", () => {
    const email = buildReminderEmail({
      kind: "vehicle",
      id: "v1",
      title: "Family car",
      vehicleField: "nextServiceDue",
      daysRemaining: 1,
      endDate: END,
      appUrl: "https://hearth.example",
    });
    expect(email.subject).toBe('Reminder: "Family car" service is due tomorrow');
    expect(email.text).toContain('The service for "Family car" is due on 20 October 2026 (tomorrow).');
    expect(email.text).toContain("https://hearth.example/vehicles/v1");
    expect(email.text).not.toMatch(/contract/i);
  });

  it("escapes HTML and keeps the subject on one line", () => {
    const email = buildReminderEmail({
      ...contract,
      title: "<b>x</b>\r\nBcc: evil@example.com",
      detail: '<img src=x onerror="alert(1)">',
    });
    expect(email.html).toContain("(&lt;img src=x onerror=&quot;alert(1)&quot;&gt;)");
    expect(email.html).not.toContain("<img");
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(email.html).not.toContain("<b>x</b>");
  });

  it("marks a test send as a test", () => {
    const email = buildReminderEmail({ ...contract, test: true });
    expect(email.subject.startsWith("[Test] ")).toBe(true);
    expect(email.text).toContain("This is a test of the reminder");
  });
});

describe("buildNtfyReminder (#352)", () => {
  it("opens the record on tap and offers an Open action", () => {
    const { headers, body } = buildNtfyReminder({ ...contract, daysRemaining: 3 });
    expect(headers.Click).toBe("https://hearth.example/contracts/c1");
    expect(headers.Actions).toBe("view, Open in Hearth, https://hearth.example/contracts/c1");
    expect(headers.Priority).toBe("high");
    expect(headers.Title).toBe("Home & Contents Insurance: contract expires in 3 days");
    expect(body).toBe('Your contract "Home & Contents Insurance" (Allianz) expires on 20 October 2026.');
  });

  it("omits Click and Actions without APP_URL", () => {
    const { headers } = buildNtfyReminder({ ...contract, appUrl: null });
    expect(headers.Click).toBeUndefined();
    expect(headers.Actions).toBeUndefined();
  });
});

describe("buildReminderWebhookBody (#352)", () => {
  it("gives vehicles their own event, field and link", () => {
    const body = buildReminderWebhookBody({
      kind: "vehicle",
      id: "v1",
      title: "Family car",
      vehicleField: "regoExpiry",
      daysRemaining: 9,
      endDate: END,
      appUrl: "https://hearth.example",
    });
    expect(body).toMatchObject({
      event: "vehicle.expiring",
      kind: "vehicle",
      field: "regoExpiry",
      endDate: "2026-10-20",
      url: "https://hearth.example/vehicles/v1",
    });
  });

  it("keeps contract payloads in their existing shape, with a null url when APP_URL is unset", () => {
    expect(buildReminderWebhookBody({ ...contract, appUrl: null })).toEqual({
      event: "contract.expiring",
      kind: "contract",
      id: "c1",
      title: "Home & Contents Insurance",
      detail: "Allianz",
      daysRemaining: 14,
      endDate: "2026-10-20",
      url: null,
    });
  });
});
