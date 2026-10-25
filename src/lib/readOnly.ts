import { redirect } from "next/navigation";
import type { Session } from "next-auth";

// Role gates actions, not visibility (CLAUDE.md): a READONLY member sees every
// household record but can't change any. The server actions' requireUser()
// is what actually enforces that. This module only keeps the UI from
// offering write controls and forms that can only fail (#400).

type SessionLike = Pick<Session, "user"> | null | undefined;

/** True when the signed-in member may create, edit or delete household records. */
export function canWrite(session: SessionLike): boolean {
  return !!session?.user && session.user.role !== "READONLY";
}

/**
 * Where a READONLY member should be sent instead of a `/new`, `/edit` or
 * `/import` page, or null when they may stay. Split out from
 * redirectIfReadOnly so the decision is testable without Next's redirect.
 */
export function readOnlyRedirectTarget(session: SessionLike, to: string): string | null {
  return session?.user?.role === "READONLY" ? to : null;
}

/**
 * Call at the top of every create/edit/import page: a READONLY member is
 * redirected to `to` (the record, or the list for a new record). A signed-out
 * visitor is left to the (app) layout's own login redirect.
 */
export function redirectIfReadOnly(session: SessionLike, to: string): void {
  const target = readOnlyRedirectTarget(session, to);
  if (target) redirect(target);
}
