import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatTimestamp } from "@/lib/utils";
import { getUserPreferences } from "@/lib/userPreferences";
import type { SecurityEventType } from "@/generated/prisma/enums";
import { BackLink } from "@/components/BackLink";
import { SETTINGS_ROUTES, settingsBackLink } from "@/lib/routeLabels";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";
import { ShareLinkRevokeButton } from "@/components/DocumentShareButton";
import { listActiveShareLinks } from "@/lib/documents/shareLinks";

export const metadata: Metadata = { title: SETTINGS_ROUTES.security.label };

const EVENT_LABELS: Record<SecurityEventType, string> = {
  LOGIN_FAILED: "Failed sign-in",
  LOGIN_THROTTLED: "Sign-in throttled",
  PASSWORD_CHANGED: "Password changed",
  PASSWORD_RESET_COMPLETED: "Password reset completed",
  TOTP_DISABLED: "Two-factor authentication disabled",
  ROLE_CHANGED: "Role changed",
  USER_DELETED: "User removed",
  MCP_AUTH_FAILED: "MCP request with a wrong token",
  MCP_THROTTLED: "MCP requests throttled",
  DOCUMENT_SHARE_LINK_CREATED: "Document shared by link",
  DOCUMENT_SHARE_LINK_REVOKED: "Share link revoked",
  AUTOFILL_CONFIRMED: "Auto-filled details confirmed",
};

// Events a household member should notice, not just an admin auditing the
// account list — everything else here is still visible to admins only.
const CONCERNING_EVENTS = new Set<SecurityEventType>([
  "LOGIN_FAILED",
  "LOGIN_THROTTLED",
  "MCP_AUTH_FAILED",
  "MCP_THROTTLED",
]);

export default async function SecurityLogPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") {
    redirect("/settings");
  }

  const [events, { dateFormat, displayTimeZone }, shareLinks] = await Promise.all([
    prisma.securityEventLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    getUserPreferences(),
    listActiveShareLinks(),
  ]);

  return (
    <PageShell width="form">
      <BackLink {...settingsBackLink(SETTINGS_ROUTES.security)} />
      <h1 className="text-2xl font-medium">{SETTINGS_ROUTES.security.label}</h1>
      <p className="text-sm text-muted">
        Security and audit events across the household — failed and throttled sign-ins and MCP
        requests, password and role changes, two-factor disablement, account removal, Documents shared by link,
        and who confirmed a record&apos;s auto-filled details. The most recent 100 events.
      </p>

      {/* #374 — links that open a Document without signing in, until they expire. */}
      <Card as="section" aria-labelledby="share-links-heading">
        <h2 id="share-links-heading" className="text-sm font-medium">
          Shared links <span className="font-normal text-muted">({shareLinks.length})</span>
        </h2>
        {shareLinks.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No Document is shared by link right now.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {shareLinks.map((link) => (
              <li key={link.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{link.filename}</p>
                  <p className="text-xs text-muted">
                    {link.createdByName ? `Shared by ${link.createdByName} · ` : ""}
                    expires {formatTimestamp(link.expiresAt, dateFormat, displayTimeZone)} · opened{" "}
                    {link.openCount === 1 ? "once" : `${link.openCount} times`}
                  </p>
                </div>
                <ShareLinkRevokeButton linkId={link.id} filename={link.filename} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card as="section">
        {events.length === 0 ? (
          <p className="text-sm text-muted">No security events recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <p
                    className={`font-medium ${CONCERNING_EVENTS.has(event.type) ? "text-warning" : ""}`}
                  >
                    {EVENT_LABELS[event.type]}
                  </p>
                  <p className="break-words text-xs text-muted">
                    {event.email ?? (event.userId ? `user ${event.userId}` : "—")}
                    {event.detail ? ` · ${event.detail}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted">
                  {formatTimestamp(event.createdAt, dateFormat, displayTimeZone)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageShell>
  );
}
