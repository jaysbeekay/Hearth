import { isValidSessionMarker } from "@/lib/offlineOwner";

// #375 — the service worker's check before it shows a Reminder. A push is
// for one member (the payload's userId); it's shown only while the worker's
// session marker says that member is signed in on this browser and the
// session hasn't expired. Otherwise the subscription was left behind (a
// session that expired, a password change, someone else signed in since),
// and the worker drops it instead of showing that member's Reminder.

/** What the service worker shows in place of a Reminder it won't show. */
export const SIGNED_OUT_NOTICE = {
  title: "Hearth",
  body: "Reminders are off on this browser. Sign in and turn them on again in Settings to get them here.",
  tag: "hearth-push-off",
} as const;

export function pushForSignedInMember(targetUserId: unknown, marker: unknown, now: number): boolean {
  return typeof targetUserId === "string" && isValidSessionMarker(marker, now) && marker.userId === targetUserId;
}
