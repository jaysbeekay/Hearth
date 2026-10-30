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

  it("says when the real Reminder goes, or plainly that none will (#387)", () => {
    const on = buildReminderEmail({
      ...contract,
      test: true,
      testPreview: { kind: "on", date: new Date("2026-10-06T00:00:00.000Z") },
    });
    expect(on.text).toContain("The real one goes out on 6 October 2026.");
    expect(buildReminderEmail({ ...contract, test: true, testPreview: { kind: "next-check" } }).text).toContain(
      "The real one goes out on its next reminder check.",
    );
    const none = buildReminderEmail({
      ...contract,
      daysRemaining: -3,
      test: true,
      testPreview: { kind: "none", reason: "its date has passed." },
    });
    expect(none.text).toContain("Hearth won't send a reminder for this record: its date has passed.");
    expect(none.text).toContain("(3 days ago)");
    expect(none.html).toContain("Hearth won&#39;t send a reminder");
    const ntfy = buildNtfyReminder({ ...contract, test: true, testPreview: { kind: "none", reason: "its date has passed." } });
    expect(ntfy.body.startsWith("This is a test. Hearth won't send a reminder")).toBe(true);
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
      cancelBy: null,
      noticePeriodDays: null,
      url: null,
    });
  });
});

describe("notice-period reminders (#351)", () => {
  const withNotice = {
    ...contract,
    daysRemaining: 9,
    notice: { cancelBy: new Date("2026-09-20T00:00:00.000Z"), noticePeriodDays: 30 },
  };

  it("emails the last day to give notice, not the end date", () => {
    const email = buildReminderEmail(withNotice);
    expect(email.subject).toBe('Reminder: notice deadline for "Home & Contents Insurance" contract in 9 days');
    expect(email.text).toContain(
      'The last day to give notice on your contract "Home & Contents Insurance" (Allianz) is 20 September 2026 (in 9 days). It ends on 20 October 2026 and needs 30 days\' notice to cancel.',
    );
    expect(email.html).toContain("<strong>20 September 2026</strong>");
  });

  it("titles the push notification as a notice deadline", () => {
    const { headers, body } = buildNtfyReminder(withNotice);
    expect(headers.Title).toBe("Home & Contents Insurance: notice deadline in 9 days");
    expect(body).toContain("is 20 September 2026.");
  });

  it("adds cancelBy and noticePeriodDays to the webhook payload", () => {
    expect(buildReminderWebhookBody(withNotice)).toMatchObject({
      event: "contract.expiring",
      daysRemaining: 9,
      endDate: "2026-10-20",
      cancelBy: "2026-09-20",
      noticePeriodDays: 30,
    });
  });
});

describe("Tenancy lease-end Reminders (#388)", () => {
  const lease: ReminderInput = {
    kind: "tenancy",
    id: "t1",
    propertyId: "p1",
    title: "Beach Flat",
    detail: "Sam Lee",
    daysRemaining: 30,
    endDate: END,
    dateFormat: "DD/MM/YYYY",
    appUrl: "https://hearth.example",
  };

  it("emails about the lease ending, linking to the Property", () => {
    const email = buildReminderEmail(lease);
    expect(email.subject).toBe('Reminder: lease for "Beach Flat" ends in 30 days');
    expect(email.text).toContain('The lease for "Beach Flat" (Sam Lee) ends on 20 October 2026 (in 30 days).');
    expect(email.text).toContain("https://hearth.example/home/p1");
    expect(email.html).toContain('href="https://hearth.example/home/p1"');
  });

  it("leaves the tenant out when there isn't one", () => {
    expect(buildReminderEmail({ ...lease, detail: "" }).text).toContain('The lease for "Beach Flat" ends on');
  });

  it("pushes by ntfy without the tenant's name, opening the Property", () => {
    const ntfy = buildNtfyReminder(lease);
    expect(ntfy.headers.Title).toBe("Lease for Beach Flat ends in 30 days");
    expect(ntfy.headers.Click).toBe("https://hearth.example/home/p1");
    expect(ntfy.body).toBe('The lease for "Beach Flat" ends on 20 October 2026.');
    expect(JSON.stringify(ntfy)).not.toContain("Sam Lee");
    expect(buildNtfyReminder({ ...lease, test: true }).headers.Title).toBe("[Test] Lease for Beach Flat ends in 30 days");
  });

  it("sends a tenancy.expiring webhook with the Tenancy and its Property, and no tenant name", () => {
    expect(buildReminderWebhookBody(lease)).toEqual({
      event: "tenancy.expiring",
      kind: "tenancy",
      id: "t1",
      title: "Beach Flat",
      propertyId: "p1",
      daysRemaining: 30,
      endDate: "2026-10-20",
      url: "https://hearth.example/home/p1",
    });
  });

  it("links a Tenancy to the Property's page", () => {
    expect(reminderRecordUrl("https://h.example", "tenancy", "p1")).toBe("https://h.example/home/p1");
  });
});
