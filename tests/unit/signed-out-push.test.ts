import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryUntilSettled } from "@/lib/retryUntilSettled";
import { readSession, refreshSessionMarker, settleSignedOutPush, unsubscribeIfStill, type SessionCheck } from "@/lib/pushClient";

// #375 — the sign-in page drops the previous member's push subscription only
// once the server confirms nobody is signed in, and keeps asking until it can.

function respond(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("readSession", () => {
  it("answers who is signed in, or null when the server can't say", async () => {
    expect(await readSession(respond(null))).toEqual({ signedIn: false });
    expect(await readSession(respond({}))).toEqual({ signedIn: false });
    expect(await readSession(respond({ user: { id: "u1" }, expires: "2026-12-07T08:00:00.000Z" }))).toEqual({
      signedIn: true,
      userId: "u1",
      expires: Date.parse("2026-12-07T08:00:00.000Z"),
    });
    expect(await readSession(respond({ user: {} }))).toEqual({ signedIn: true, userId: null, expires: NaN });
    expect(await readSession(respond({ error: "x" }, 500))).toBeNull();
    expect(await readSession(vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch)).toBeNull();
    expect(await readSession(vi.fn(async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch)).toBeNull();
  });

  it("gives up on a server that never answers, so the next try isn't held up", async () => {
    const stalled = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    ) as unknown as typeof fetch;
    expect(await readSession(stalled, 20)).toBeNull();
  });
});

describe("settleSignedOutPush", () => {
  function sub(endpoint = "https://push.example/a", result: Promise<boolean> | (() => Promise<boolean>) = async () => true) {
    return { endpoint, unsubscribe: vi.fn(typeof result === "function" ? result : () => result) };
  }
  function deps(session: SessionCheck, current: ReturnType<typeof sub> | null | Error = sub()) {
    return {
      readSession: vi.fn(async () => session),
      lookup: vi.fn(async () => {
        if (current instanceof Error) throw current;
        return current;
      }),
      markSignedIn: vi.fn(async () => {}),
      markSignedOut: vi.fn(async () => {}),
    };
  }

  it("drops the subscription once the server says nobody is signed in, and tells the worker", async () => {
    const s = sub();
    const d = deps({ signedIn: false }, s);
    expect(await settleSignedOutPush(d)).toBe(true);
    expect(s.unsubscribe).toHaveBeenCalled();
    expect(d.markSignedOut).toHaveBeenCalled();
  });

  it("keeps push for a member signed in after all, and writes their marker again", async () => {
    const s = sub();
    const d = deps({ signedIn: true, userId: "u1", expires: 123 }, s);
    expect(await settleSignedOutPush(d)).toBe(true);
    expect(s.unsubscribe).not.toHaveBeenCalled();
    expect(d.markSignedOut).not.toHaveBeenCalled();
    expect(d.markSignedIn).toHaveBeenCalledWith("u1", 123);
  });

  it("looks the subscription up only after the server has answered", async () => {
    let answer: (s: SessionCheck) => void = () => {};
    const d = deps({ signedIn: false });
    d.readSession.mockImplementation(() => new Promise<SessionCheck>((r) => { answer = r; }));
    const settled = settleSignedOutPush(d);
    await Promise.resolve();
    expect(d.lookup).not.toHaveBeenCalled();
    answer({ signedIn: false });
    expect(await settled).toBe(true);
    expect(d.lookup).toHaveBeenCalledTimes(1);
  });

  it("leaves push alone for a member signed in, writing a marker only from a usable answer", async () => {
    const s = sub();
    for (const session of [
      { signedIn: true as const, userId: null, expires: 123 },
      { signedIn: true as const, userId: "u1", expires: NaN },
    ]) {
      const d = deps(session, s);
      expect(await settleSignedOutPush(d)).toBe(true);
      expect(d.markSignedIn).not.toHaveBeenCalled();
      expect(d.lookup).not.toHaveBeenCalled();
    }
    expect(s.unsubscribe).not.toHaveBeenCalled();
  });

  it("still drops the subscription when telling the worker fails", async () => {
    const s = sub();
    const d = deps({ signedIn: false }, s);
    d.markSignedOut.mockRejectedValueOnce(new Error("quota"));
    expect(await settleSignedOutPush(d)).toBe(true);
    expect(s.unsubscribe).toHaveBeenCalled();
  });

  it("tries again when the server, the browser or the unsubscribe can't be relied on", async () => {
    expect(await settleSignedOutPush(deps(null))).toBe(false);
    expect(await settleSignedOutPush(deps({ signedIn: false }, new Error("timed out")))).toBe(false);
    expect(await settleSignedOutPush(deps({ signedIn: false }, sub(undefined, async () => false)))).toBe(false);
    expect(await settleSignedOutPush(deps({ signedIn: false }, null))).toBe(true);
  });
});

describe("refreshSessionMarker", () => {
  it("writes the marker only for this tab's member, with an expiry the server gave", async () => {
    const mark = vi.fn(async () => {});
    const ask = (session: SessionCheck) => refreshSessionMarker("u1", { readSession: async () => session, mark });

    expect(await ask({ signedIn: true, userId: "u1", expires: 500 })).toBe(true);
    expect(mark).toHaveBeenCalledWith("u1", 500);
    mark.mockClear();
    expect(await ask({ signedIn: true, userId: "u2", expires: 500 })).toBe(false);
    expect(await ask({ signedIn: true, userId: "u1", expires: NaN })).toBe(false);
    expect(await ask({ signedIn: false })).toBe(false);
    expect(await ask(null)).toBe(false);
    expect(mark).not.toHaveBeenCalled();
  });
});

describe("unsubscribeIfStill", () => {
  it("drops only the subscription it was asked about, and says when it couldn't tell", async () => {
    const mine = { endpoint: "https://push.example/old", unsubscribe: vi.fn(async () => true) };
    expect(await unsubscribeIfStill("https://push.example/old", async () => mine)).toBe(true);
    expect(mine.unsubscribe).toHaveBeenCalledTimes(1);

    const turnedOnSince = { endpoint: "https://push.example/new", unsubscribe: vi.fn(async () => true) };
    expect(await unsubscribeIfStill("https://push.example/old", async () => turnedOnSince)).toBe(true);
    expect(turnedOnSince.unsubscribe).not.toHaveBeenCalled();

    expect(await unsubscribeIfStill("https://push.example/old", async () => { throw new Error("timed out"); })).toBe(false);
  });
});

describe("retryUntilSettled", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tries again on a timer and when the browser comes back online, until it settles", async () => {
    const target = new EventTarget();
    const answers = [false, false, true];
    const attempt = vi.fn(async () => answers.shift() ?? true);

    retryUntilSettled(attempt, { retryMs: 30_000, target });
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);

    target.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(attempt).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(120_000);
    target.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("counts a throw as unsettled, never overlaps attempts, and stops on unmount", async () => {
    const target = new EventTarget();
    let release: (v: boolean) => void = () => {};
    const attempt = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementation(() => new Promise<boolean>((r) => { release = r; }));

    const stop = retryUntilSettled(attempt, { retryMs: 1_000, target });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(attempt).toHaveBeenCalledTimes(2);

    target.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(2);

    release(false);
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    target.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});
