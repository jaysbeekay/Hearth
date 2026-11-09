import { describe, expect, it, vi } from "vitest";
import type { SessionCheck } from "@/lib/pushClient";
import { reuseFirstSession, runSignedOutCleanup } from "@/lib/signedOutCleanup";

// #576 — the sign-in page clears this browser's offline data and signs out
// the other tabs only once it knows nobody is signed in. Going Back to a
// cached sign-in page while signed in leaves everything as it was.

function deps(session: SessionCheck | Promise<SessionCheck>) {
  const calls: string[] = [];
  return {
    calls,
    readSession: vi.fn(async () => {
      calls.push("read");
      return session;
    }),
    clear: vi.fn(async () => {
      calls.push("clear");
    }),
    broadcast: vi.fn(() => {
      calls.push("broadcast");
    }),
    startPush: vi.fn((first: SessionCheck) => {
      calls.push(`push:${first === null ? "unknown" : first.signedIn ? "in" : "out"}`);
    }),
  };
}

describe("runSignedOutCleanup", () => {
  it("still signed in (Back to a cached sign-in page): clears nothing, tells no tab, leaves push alone", async () => {
    const d = deps({ signedIn: true, userId: "u1", expires: Date.now() + 60_000 });
    expect(await runSignedOutCleanup(d)).toBe("kept");
    expect(d.calls).toEqual(["read"]);
  });

  it("signed out: tells the other tabs, clears, then settles push with the same answer", async () => {
    const d = deps({ signedIn: false });
    expect(await runSignedOutCleanup(d)).toBe("cleared");
    expect(d.calls).toEqual(["read", "broadcast", "clear", "push:out"]);
    expect(d.readSession).toHaveBeenCalledTimes(1);
  });

  it("server couldn't be asked (offline): clears as before, and push keeps asking", async () => {
    const d = deps(null);
    expect(await runSignedOutCleanup(d)).toBe("cleared");
    expect(d.calls).toEqual(["read", "broadcast", "clear", "push:unknown"]);
  });

  it("push waits for the clear, which deletes the marker push may write", async () => {
    const d = deps({ signedIn: false });
    let finish: () => void = () => {};
    d.clear.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            d.calls.push("clear");
            resolve();
          };
        }),
    );
    const done = runSignedOutCleanup(d);
    await Promise.resolve();
    await Promise.resolve();
    expect(d.startPush).not.toHaveBeenCalled();
    finish();
    await done;
    expect(d.calls).toEqual(["read", "broadcast", "clear", "push:out"]);
  });

  it("a clear that fails still goes on to push", async () => {
    const d = deps({ signedIn: false });
    d.clear.mockRejectedValue(new Error("quota"));
    expect(await runSignedOutCleanup(d)).toBe("cleared");
    expect(d.startPush).toHaveBeenCalledWith({ signedIn: false });
  });
});

describe("reuseFirstSession", () => {
  it("answers the first ask with the known session, then asks the server", async () => {
    const read = vi.fn(async (): Promise<SessionCheck> => ({ signedIn: true, userId: "u2", expires: 1 }));
    const ask = reuseFirstSession({ signedIn: false }, read);
    expect(await ask()).toEqual({ signedIn: false });
    expect(read).not.toHaveBeenCalled();
    expect(await ask()).toEqual({ signedIn: true, userId: "u2", expires: 1 });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("asks the server straight away when the first answer was unknown", async () => {
    const read = vi.fn(async (): Promise<SessionCheck> => ({ signedIn: false }));
    const ask = reuseFirstSession(null, read);
    expect(await ask()).toEqual({ signedIn: false });
    expect(read).toHaveBeenCalledTimes(1);
  });
});
