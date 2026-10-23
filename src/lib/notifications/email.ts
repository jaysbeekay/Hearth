import nodemailer from "nodemailer";
import { getSmtpConfig, isSmtpConfigured } from "@/lib/appSettings";
import { buildReminderEmail, type ReminderInput } from "@/lib/notifications/reminderContent";

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

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  if (!(await isSmtpConfigured())) return;

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
    subject: "Reset your Hearth password",
    text: `We received a request to reset your Hearth password. Follow this link to choose a new one (expires in 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
    html: `<p>We received a request to reset your Hearth password.</p><p><a href="${resetUrl}">Choose a new password</a> (link expires in 1 hour).</p><p>If you didn't request this, you can ignore this email.</p>`,
  });
}

export async function sendInvitationEmail(to: string, inviteUrl: string) {
  if (!(await isSmtpConfigured())) return;

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
    subject: "You've been invited to Hearth",
    text: `You've been added to a Hearth household. Follow this link to set your password and sign in (expires in 48 hours):\n\n${inviteUrl}\n\nIf you weren't expecting this, you can ignore this email.`,
    html: `<p>You've been added to a Hearth household.</p><p><a href="${inviteUrl}">Set your password and sign in</a> (link expires in 48 hours).</p><p>If you weren't expecting this, you can ignore this email.</p>`,
  });
}

export async function sendReminderEmail(to: string, input: ReminderInput) {
  if (!(await isSmtpConfigured())) return;

  const smtp = await getSmtpConfig();
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });

  // Wording, date format and the link back to the record come from the
  // shared builder (#352), so every channel says the same thing.
  const { subject, text, html } = buildReminderEmail(input);
  await transporter.sendMail({ from: smtp.from, to, subject: stripNewlines(subject), text, html });
}
