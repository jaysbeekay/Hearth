import { isValidSessionMarker } from "@/lib/offlineOwner";

// #375 — the service worker's check before it shows a Reminder. A push is
// for one member (the payload's userId), and its content is shown only while
// the worker's session marker says that member is signed in on this browser.
//
// Anything else shows a notice with none of the Reminder's content. The
// subscription itself is dropped only on positive evidence that it was left
// behind: the sign-in page confirmed the session ended (the signed-out
// marker), someone else is signed in here, or the member's marker ran out
// more than a week ago. A missing marker alone isn't enough: it also goes
// missing while a member is still signed in (between a sign-out that then
// fails and putting it back, Back to a cached sign-in page), and dropping a
// subscription can't be undone from here.

/** How long past its expiry a member's marker still counts as maybe signed in. */
export const MARKER_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Written by the sign-in page once the server confirms nobody is signed in. */
export interface SignedOutMarker {
  signedOut: true;
}

export function isSignedOutMarker(value: unknown): value is SignedOutMarker {
  return !!value && typeof value === "object" && (value as Partial<SignedOutMarker>).signedOut === true;
}

/** What the service worker shows in place of a Reminder it won't show. */
export const SIGNED_OUT_NOTICE = {
  title: "Hearth",
  body: "A Reminder arrived for someone who isn't signed in on this browser. Sign in to see it.",
  tag: "hearth-push-signed-out",
  url: "/settings",
} as const;

export type PushDecision = "show" | "notice" | "notice-and-drop";

export function pushDecision(targetUserId: unknown, marker: unknown, now: number): PushDecision {
  if (isSignedOutMarker(marker)) return "notice-and-drop";
  if (typeof targetUserId !== "string" || targetUserId === "") return "notice";
  if (isValidSessionMarker(marker, now)) return marker.userId === targetUserId ? "show" : "notice-and-drop";
  // An expired marker: long expired means the session is over.
  if (isValidSessionMarker(marker, now - MARKER_GRACE_MS)) return "notice";
  return marker && typeof marker === "object" && "userId" in marker ? "notice-and-drop" : "notice";
}

export type PushPayload = { title?: unknown; body?: unknown; url?: unknown; tag?: unknown; userId?: unknown };

export interface PushHandlerDeps {
  readMarker: () => Promise<unknown>;
  show: (title: string, options: NotificationOptions) => Promise<void>;
  /** Drops this browser's subscription. */
  unsubscribe: () => Promise<unknown>;
  now: () => number;
}

/** The service worker's push handler, minus the worker. */
export async function handlePush(payload: PushPayload, deps: PushHandlerDeps): Promise<void> {
  const marker = await deps.readMarker().catch(() => null);
  const decision = pushDecision(payload.userId, marker, deps.now());
  if (decision === "show") {
    await deps.show(typeof payload.title === "string" ? payload.title : "Hearth reminder", {
      body: typeof payload.body === "string" ? payload.body : undefined,
      tag: typeof payload.tag === "string" ? payload.tag : undefined,
      icon: "/icon.svg",
      data: { url: typeof payload.url === "string" ? payload.url : "/dashboard" },
    });
    return;
  }
  // The notice first: a push must show something, and a stalled
  // unsubscribe mustn't stop it.
  await Promise.allSettled([
    deps.show(SIGNED_OUT_NOTICE.title, {
      body: SIGNED_OUT_NOTICE.body,
      tag: SIGNED_OUT_NOTICE.tag,
      icon: "/icon.svg",
      data: { url: SIGNED_OUT_NOTICE.url },
    }),
    decision === "notice-and-drop" ? deps.unsubscribe() : Promise.resolve(),
  ]);
}
