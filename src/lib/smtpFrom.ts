// The From address on outgoing mail. Many SMTP servers (Postfix with
// reject_non_fqdn_sender, most hosted relays) refuse a sender whose domain
// isn't fully qualified, and the old default, "Hearth <no-reply@localhost>",
// was exactly that: every email, password resets included, bounced at the
// server with "504 5.5.2 Sender address rejected: need fully-qualified address".

const ADDRESS = /^[^\s@<>]+@([^\s@<>]+)$/;

/** The bare address in `Name <addr@host>` or `addr@host`, or "" if there isn't one. */
export function smtpFromAddress(value: string): string {
  const trimmed = value.trim();
  const bracketed = /<([^<>]*)>\s*$/.exec(trimmed);
  const address = (bracketed ? bracketed[1] : trimmed).trim();
  return ADDRESS.test(address) ? address : "";
}

/** True when the address's domain has a dot and isn't localhost. */
export function isQualifiedSmtpFrom(value: string): boolean {
  const domain = ADDRESS.exec(smtpFromAddress(value))?.[1]?.toLowerCase() ?? "";
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".") && !domain.endsWith(".localhost");
}

/**
 * The From address to send with: the configured one when it's fully
 * qualified, else the SMTP username when that is an email address (most
 * providers only accept mail from the account you sign in as anyway), else
 * the configured value as-is, so the server's own error still explains it.
 */
export function resolveSmtpFrom(configured: string, user: string): string {
  if (isQualifiedSmtpFrom(configured)) return configured.trim();
  if (isQualifiedSmtpFrom(user)) return `Hearth <${smtpFromAddress(user)}>`;
  return configured.trim();
}

/**
 * SMTP_FROM from the environment, used when no From is saved in Settings.
 * An unqualified one (the old default, still in many .env files) counts as
 * unset: otherwise Settings would show it in the From field, every save of
 * the form would be refused over it, and clearing the field would only bring
 * it back from .env.
 */
export function envSmtpFromFallback(envFrom: string): string {
  return isQualifiedSmtpFrom(envFrom) ? envFrom.trim() : "";
}

/**
 * Settings' warning when Hearth's mail will go out from an address servers
 * reject, or from a different address than the one entered. Null when
 * there's nothing to say, including before SMTP is set up.
 */
export function smtpFromWarning(current: { host: string; from: string; sentFrom: string }): string | null {
  if (!current.host) return null;
  const from = current.from.trim();
  if (isQualifiedSmtpFrom(current.sentFrom)) {
    return from && !isQualifiedSmtpFrom(from)
      ? `The From address "${from}" isn't a full address on a real domain, so Hearth sends as ${current.sentFrom} instead. Set your own address, or clear the field.`
      : null;
  }
  return from
    ? `The From address "${from}" isn't a full address on a real domain, so mail servers will reject Hearth's emails. Use an address like Hearth <hearth@example.com>.`
    : "Set a From address, like Hearth <hearth@example.com>. The SMTP username isn't an email address, so Hearth has no address to send as and mail servers will reject its emails.";
}
