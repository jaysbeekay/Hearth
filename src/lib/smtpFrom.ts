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
