// What every reminder channel says (#352): one builder for email, ntfy and
// webhook content so they agree on wording, dates and the link back to the
// record. Pure — no I/O — so it's unit-tested directly
// (tests/unit/reminderContent.test.ts).

export type ReminderKind = "contract" | "warranty" | "vehicle";
export type VehicleReminderField = "regoExpiry" | "insuranceExpiry" | "nextServiceDue";

export interface ReminderInput {
  kind: ReminderKind;
  id: string;
  /** Contract title, warranty description, or vehicle label. */
  title: string;
  /** Provider / manufacturer; omitted for vehicles. */
  detail?: string;
  /** Which date a vehicle reminder is about. Required when kind is "vehicle". */
  vehicleField?: VehicleReminderField;
  /** Days until the date this reminder is about — the notice deadline when `notice` is set. */
  daysRemaining: number;
  endDate: Date;
  /**
   * #351 — set when the contract has a notice period: the reminder is about
   * the last day to give notice, not the end date.
   */
  notice?: { cancelBy: Date; noticePeriodDays: number };
  /** The recipient's (email) or household's (ntfy, webhook) date format preference. */
  dateFormat?: string | null;
  /** APP_URL when it's configured; null leaves the link out rather than pointing at a guess. */
  appUrl?: string | null;
  /** A "Send test reminder" preview of this exact message. */
  test?: boolean;
  /**
   * With `test`: when the real Reminder goes out, per the Reminder schedule
   * (#387) — on the next check, on a day, or never (with why).
   */
  testPreview?: TestPreview;
}

export type TestPreview =
  | { kind: "next-check" }
  | { kind: "on"; date: Date }
  | { kind: "none"; reason: string };

function testNoteText(input: ReminderInput): string {
  const preview = input.testPreview;
  if (!preview) return "This is a test of the reminder Hearth sends for this record.";
  if (preview.kind === "none") return `This is a test. Hearth won't send a reminder for this record: ${preview.reason}`;
  const when =
    preview.kind === "next-check"
      ? "on its next reminder check"
      : `on ${formatReminderDate(preview.date, input.dateFormat)}`;
  return `This is a test of the reminder Hearth sends for this record. The real one goes out ${when}.`;
}

const RECORD_PATH: Record<ReminderKind, string> = {
  contract: "contracts",
  warranty: "products",
  vehicle: "vehicles",
};

const VEHICLE_SUBJECT: Record<VehicleReminderField, { noun: string; verb: string }> = {
  regoExpiry: { noun: "registration", verb: "expires" },
  insuranceExpiry: { noun: "insurance", verb: "expires" },
  nextServiceDue: { noun: "service", verb: "is due" },
};

export function reminderRecordUrl(
  appUrl: string | null | undefined,
  kind: ReminderKind,
  id: string,
): string | null {
  if (!appUrl) return null;
  return `${appUrl.replace(/\/+$/, "")}/${RECORD_PATH[kind]}/${encodeURIComponent(id)}`;
}

/**
 * A long-form date in the user's chosen order: "20 October 2026",
 * "October 20, 2026" or "2026-10-20". Formatted in UTC because these are
 * date-only values (stored at UTC midnight); formatting them in the
 * server's local zone could show the previous day.
 */
export function formatReminderDate(date: Date, dateFormat?: string | null): string {
  switch (dateFormat) {
    case "MM/DD/YYYY":
      return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
    case "YYYY-MM-DD":
      return date.toISOString().slice(0, 10);
    default:
      return date.toLocaleDateString("en-AU", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  }
}

function inDays(days: number): string {
  // Only a test preview of a date that has passed is ever negative.
  if (days < 0) return days === -1 ? "yesterday" : `${-days} days ago`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function subjectParts(input: ReminderInput): { noun: string; verb: string } {
  if (input.kind === "vehicle") return VEHICLE_SUBJECT[input.vehicleField ?? "regoExpiry"];
  return { noun: input.kind, verb: "expires" };
}

// Header values must never contain raw newlines, to defend against
// header/CRLF injection from user-entered titles.
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "Your contract "X" (Allianz) expires" / "The registration for "Car" expires". */
function sentenceStart(input: ReminderInput, quote: (s: string) => string): string {
  const { noun, verb } = subjectParts(input);
  if (input.kind === "vehicle") return `The ${noun} for ${quote(input.title)} ${verb}`;
  const detail = input.detail?.trim();
  return `Your ${noun} ${quote(input.title)}${detail ? ` (${detail})` : ""} ${verb}`;
}

/** "The last day to give notice on your contract "X" (Allianz) is" */
function noticeStart(input: ReminderInput, quote: (s: string) => string): string {
  const detail = input.detail?.trim();
  return `The last day to give notice on your ${input.kind} ${quote(input.title)}${detail ? ` (${detail})` : ""} is`;
}

function noticeTail(input: ReminderInput, endDate: string): string {
  const days = input.notice!.noticePeriodDays;
  return `It ends on ${endDate} and needs ${days} day${days === 1 ? "" : "s"}' notice to cancel.`;
}

export function buildReminderEmail(input: ReminderInput): { subject: string; text: string; html: string } {
  const { noun, verb } = subjectParts(input);
  const endDate = formatReminderDate(input.endDate, input.dateFormat);
  const date = input.notice ? formatReminderDate(input.notice.cancelBy, input.dateFormat) : endDate;
  const when = inDays(input.daysRemaining);
  const url = reminderRecordUrl(input.appUrl, input.kind, input.id);

  const subject = oneLine(
    input.notice
      ? `${input.test ? "[Test] " : ""}Reminder: notice deadline for "${input.title}" ${noun} ${when}`
      : `${input.test ? "[Test] " : ""}Reminder: "${input.title}" ${noun} ${verb} ${when}`,
  );

  const testNote = input.test ? `${testNoteText(input)}\n\n` : "";
  const lead = input.notice
    ? `${noticeStart(input, (s) => `"${s}"`)} ${date} (${when}). ${noticeTail(input, endDate)}`
    : `${sentenceStart(input, (s) => `"${s}"`)} on ${date} (${when}).`;
  const text = url
    ? `${testNote}${lead}\n\nOpen it in Hearth: ${url}`
    : `${testNote}${lead}\n\nLog in to Hearth to review it.`;

  const htmlInput = { ...input, detail: input.detail ? escapeHtml(input.detail) : undefined };
  const strong = (s: string) => `<strong>${escapeHtml(s)}</strong>`;
  const htmlLead = input.notice
    ? `${noticeStart(htmlInput, strong)} ${strong(date)} (${when}). ${escapeHtml(noticeTail(input, endDate))}`
    : `${sentenceStart(htmlInput, strong)} on ${strong(date)} (${when}).`;
  const html = [
    input.test ? `<p><em>${escapeHtml(testNoteText(input))}</em></p>` : "",
    `<p>${htmlLead}</p>`,
    url
      ? `<p><a href="${escapeHtml(url)}">Open it in Hearth</a></p>`
      : "<p>Log in to Hearth to review it.</p>",
  ].join("");

  return { subject, text, html };
}

/** ntfy publish headers + body. Click/Actions make the notification open the record. */
export function buildNtfyReminder(input: ReminderInput): { headers: Record<string, string>; body: string } {
  const { noun, verb } = subjectParts(input);
  const endDate = formatReminderDate(input.endDate, input.dateFormat);
  const when = inDays(input.daysRemaining);
  const url = reminderRecordUrl(input.appUrl, input.kind, input.id);

  const headers: Record<string, string> = {
    Title: oneLine(
      input.notice
        ? `${input.test ? "[Test] " : ""}${input.title}: notice deadline ${when}`
        : `${input.test ? "[Test] " : ""}${input.title}: ${noun} ${verb} ${when}`,
    ),
    Priority: input.daysRemaining <= 7 ? "high" : "default",
    Tags: "warning,calendar",
  };
  if (url) {
    headers.Click = url;
    headers.Actions = `view, Open in Hearth, ${url}`;
  }
  const lead = input.notice
    ? `${noticeStart(input, (s) => `"${s}"`)} ${formatReminderDate(input.notice.cancelBy, input.dateFormat)}. ${noticeTail(input, endDate)}`
    : `${sentenceStart(input, (s) => `"${s}"`)} on ${endDate}.`;
  // A test that previews the schedule says when (or whether) the real one goes.
  const body = input.test && input.testPreview ? `${testNoteText(input)}\n\n${lead}` : lead;
  return { headers, body };
}

export function buildReminderWebhookBody(input: ReminderInput): Record<string, unknown> {
  return {
    event: `${input.kind}.expiring`,
    kind: input.kind,
    id: input.id,
    title: input.title,
    detail: input.detail ?? "",
    ...(input.kind === "vehicle" ? { field: input.vehicleField } : {}),
    daysRemaining: input.daysRemaining,
    endDate: input.endDate.toISOString().slice(0, 10),
    ...(input.kind === "contract"
      ? {
          cancelBy: input.notice ? input.notice.cancelBy.toISOString().slice(0, 10) : null,
          noticePeriodDays: input.notice?.noticePeriodDays ?? null,
        }
      : {}),
    url: reminderRecordUrl(input.appUrl, input.kind, input.id),
  };
}
