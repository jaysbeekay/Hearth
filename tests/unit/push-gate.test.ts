import { describe, expect, it, vi } from "vitest";
import { handlePush, MARKER_GRACE_MS, pushDecision, SIGNED_OUT_NOTICE } from "@/lib/pushGate";

// #375 — the service worker shows a Reminder's content only while the member
// it's for is signed in on this browser, and drops the subscription only on
// positive evidence that it was left behind.

const now = Date.parse("2026-11-07T08:00:00Z");
const signedIn = (userId: string, expires = now + 60_000) => ({ userId, expires });

describe("pushDecision", () => {
  it("shows a Reminder to the member signed in here", () => {
    expect(pushDecision("u1", signedIn("u1"), now)).toBe("show");
  });

  it("drops the subscription when the sign-in page saw the session end, or someone else is signed in", () => {
    expect(pushDecision("u1", { signedOut: true }, now)).toBe("notice-and-drop");
    expect(pushDecision("u1", signedIn("u2"), now)).toBe("notice-and-drop");
  });

  it("drops it once the member's session ran out more than a week ago", () => {
    expect(pushDecision("u1", signedIn("u1", now - MARKER_GRACE_MS - 1), now)).toBe("notice-and-drop");
  });

  it("only holds the content back when it can't be sure the session is over", () => {
    expect(pushDecision("u1", signedIn("u1", now), now)).toBe("notice");
    expect(pushDecision("u1", signedIn("u1", now - MARKER_GRACE_MS + 1), now)).toBe("notice");
    expect(pushDecision("u1", null, now)).toBe("notice");
    expect(pushDecision("u1", { expires: now + 1 }, now)).toBe("notice");
    expect(pushDecision("u1", { userId: "u1" }, now)).toBe("notice");
    expect(pushDecision("u1", { userId: "u1", expires: null }, now)).toBe("notice");
    expect(pushDecision(undefined, signedIn("u1"), now)).toBe("notice");
    expect(pushDecision("", signedIn(""), now)).toBe("notice");
    expect(pushDecision(42, signedIn("u1"), now)).toBe("notice");
  });
});

describe("handlePush", () => {
  const reminder = { title: "Home insurance", body: "Renews in 14 days", url: "/contracts/c1", tag: "c1", userId: "u1" };

  function deps(marker: unknown, unsubscribe: () => Promise<unknown> = async () => true) {
    return { readMarker: vi.fn(async () => marker), show: vi.fn(async () => {}), unsubscribe: vi.fn(unsubscribe), now: () => now };
  }

  it("shows the Reminder and keeps the subscription for the member signed in", async () => {
    const d = deps(signedIn("u1"));
    await handlePush(reminder, d);
    expect(d.show).toHaveBeenCalledWith("Home insurance", expect.objectContaining({ body: "Renews in 14 days", data: { url: "/contracts/c1" } }));
    expect(d.unsubscribe).not.toHaveBeenCalled();
  });

  it("shows a notice with none of the Reminder's content, and drops a left-behind subscription", async () => {
    const d = deps(signedIn("u2"));
    await handlePush(reminder, d);
    expect(d.show).toHaveBeenCalledTimes(1);
    const [title, options] = d.show.mock.calls[0] as unknown as [string, NotificationOptions];
    expect(title).toBe(SIGNED_OUT_NOTICE.title);
    expect(options.data).toEqual({ url: "/settings" });
    expect(`${title} ${options.body} ${options.tag}`).not.toMatch(/Home insurance|14 days|c1/);
    expect(d.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("keeps the subscription when the marker is just missing, or can't be read", async () => {
    const missing = deps(null);
    await handlePush(reminder, missing);
    expect(missing.unsubscribe).not.toHaveBeenCalled();
    expect(missing.show).toHaveBeenCalledWith(SIGNED_OUT_NOTICE.title, expect.anything());

    const unreadable = deps(null);
    unreadable.readMarker.mockRejectedValueOnce(new Error("cache gone"));
    await handlePush(reminder, unreadable);
    expect(unreadable.unsubscribe).not.toHaveBeenCalled();
  });

  it("shows the notice even when unsubscribing fails or never finishes", async () => {
    const failing = deps({ signedOut: true }, async () => { throw new Error("no"); });
    await handlePush(reminder, failing);
    expect(failing.show).toHaveBeenCalledTimes(1);

    const stalled = deps({ signedOut: true }, () => new Promise(() => {}));
    void handlePush(reminder, stalled);
    await vi.waitFor(() => expect(stalled.show).toHaveBeenCalledTimes(1));
  });
});
