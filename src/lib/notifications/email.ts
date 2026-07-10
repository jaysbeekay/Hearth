import nodemailer from "nodemailer";
import { getSmtpConfig, isSmtpConfigured } from "@/lib/appSettings";

export async function sendTestEmail(to: string) {
  if (!(await isSmtpConfigured())) throw new Error("SMTP is not configured.");

  const smtp = await getSmtpConfig();
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });

  await transporter.sendMail({
    from: smtp.from,
    to,
    subject: "Hearth test email",
    text: "This is a test email from Hearth to confirm your SMTP settings are working.",
    html: "<p>This is a test email from Hearth to confirm your SMTP settings are working.</p>",
  });
}

// Header values must never contain raw newlines, regardless of nodemailer's
// own escaping, to defend against header/CRLF injection from contract titles.
function stripNewlines(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export async function sendReminderEmail(opts: {
  to: string;
  kind: "contract" | "warranty";
  title: string;
  detail: string;
  daysRemaining: number;
  endDate: Date;
}) {
  if (!(await isSmtpConfigured())) return;

  const smtp = await getSmtpConfig();
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });

  const subject = stripNewlines(
    `Reminder: "${opts.title}" ${opts.kind} expires in ${opts.daysRemaining} day${
      opts.daysRemaining === 1 ? "" : "s"
    }`,
  );

  const formattedDate = opts.endDate.toLocaleDateString("en-AU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  await transporter.sendMail({
    from: smtp.from,
    to: opts.to,
    subject,
    text: `Your ${opts.kind} "${opts.title}" (${opts.detail}) expires on ${formattedDate} (${opts.daysRemaining} day(s) from now).\n\nLog in to Hearth to review it.`,
    html: `<p>Your ${opts.kind} <strong>${escapeHtml(opts.title)}</strong> (${escapeHtml(
      opts.detail,
    )}) expires on <strong>${formattedDate}</strong> (${opts.daysRemaining} day(s) from now).</p><p>Log in to Hearth to review it.</p>`,
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
