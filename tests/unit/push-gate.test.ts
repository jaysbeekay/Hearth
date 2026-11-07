import { describe, expect, it } from "vitest";
import { pushForSignedInMember } from "@/lib/pushGate";

// #375 — the service worker shows a Reminder only while the member it's for
// is signed in on this browser; anything else means the subscription was
// left behind, and the worker drops it.

const now = Date.parse("2026-11-07T08:00:00Z");
const signedIn = (userId: string, expires = now + 60_000) => ({ userId, expires });

describe("pushForSignedInMember", () => {
  it("shows a Reminder for the member signed in here", () => {
    expect(pushForSignedInMember("u1", signedIn("u1"), now)).toBe(true);
  });

  it("drops one for someone else, after the session expired, or with nobody signed in", () => {
    expect(pushForSignedInMember("u1", signedIn("u2"), now)).toBe(false);
    expect(pushForSignedInMember("u1", signedIn("u1", now - 1), now)).toBe(false);
    expect(pushForSignedInMember("u1", null, now)).toBe(false);
    expect(pushForSignedInMember("u1", { userId: "u1" }, now)).toBe(false);
  });

  it("drops a payload that doesn't say who it's for", () => {
    expect(pushForSignedInMember(undefined, signedIn("u1"), now)).toBe(false);
    expect(pushForSignedInMember("", signedIn(""), now)).toBe(false);
    expect(pushForSignedInMember(42, signedIn("u1"), now)).toBe(false);
  });
});
