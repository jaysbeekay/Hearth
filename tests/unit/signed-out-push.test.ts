import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryUntilSettled } from "@/lib/retryUntilSettled";
import { sessionEnded } from "@/lib/pushClient";

// #375 — the sign-in page drops the previous member's push subscription only
// once the server confirms nobody is signed in, and keeps asking until it can.

function respond(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("sessionEnded", () => {
  it("answers whether anyone is signed in, or null when the server can't say", async () => {
    expect(await sessionEnded(respond(null))).toBe(true);
    expect(await sessionEnded(respond({}))).toBe(true);
    expect(await sessionEnded(respond({ user: { id: "u1" } }))).toBe(false);
    expect(await sessionEnded(respond({ error: "x" }, 500))).toBeNull();
    expect(await sessionEnded(vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch)).toBeNull();
    expect(await sessionEnded(vi.fn(async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch)).toBeNull();
  });

  it("gives up on a server that never answers, so the next try isn't held up", async () => {
    const stalled = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    ) as unknown as typeof fetch;
    expect(await sessionEnded(stalled, 20)).toBeNull();
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
