import { describe, expect, it, vi } from "vitest";
import type { SessionCheck } from "@/lib/pushClient";
import { runSignedOutCleanup } from "@/lib/signedOutCleanup";

// #576 — the sign-in page clears this browser's offline data and signs out
// the other tabs only once it knows nobody is signed in. Going Back to a
// cached sign-in page while signed in leaves everything as it was.

function deps(...answers: (SessionCheck | Error)[]) {
  const calls: string[] = [];
  let left = false;
  const d = {
    calls,
    leave: () => {
      left = true;
    },
    readSession: vi.fn(async (): Promise<SessionCheck> => {
      calls.push("read");
      const answer = answers.shift();
      if (answer instanceof Error) throw answer;
      return answer ?? null;
    }),
    hasLeft: () => left,
    clear: vi.fn(async () => {
      calls.push("clear");
    }),
    broadcast: vi.fn(() => {
      calls.push("broadcast");
    }),
    startPush: vi.fn(() => {
      calls.push("push");
    }),
  };
  return d;
}

const signedIn: SessionCheck = { signedIn: true, userId: "u1", expires: Date.now() + 60_000 };

describe("runSignedOutCleanup", () => {
  it("still signed in (Back to a cached sign-in page): clears nothing, tells no tab, leaves push alone", async () => {
    const d = deps(signedIn);
    expect(await runSignedOutCleanup(d)).toBe("kept");
    expect(d.calls).toEqual(["read"]);
  });

  it("signed out: tells the other tabs, clears, then starts push", async () => {
    const d = deps({ signedIn: false });
    expect(await runSignedOutCleanup(d)).toBe("cleared");
    expect(d.calls).toEqual(["read", "broadcast", "clear", "push"]);
  });

  it("server couldn't be asked (offline): clears as before", async () => {
    const d = deps(null);
    expect(await runSignedOutCleanup(d)).toBe("cleared");
    expect(d.calls).toEqual(["read", "broadcast", "clear", "push"]);
  });

  it("a session check that throws counts as couldn't ask, and clears", async () => {
    const d = deps(new Error("boom"));
    expect(await runSignedOutCleanup(d)).toBe("cleared");
    expect(d.calls).toEqual(["read", "broadcast", "clear", "push"]);
  });

  it("push waits for the clear, which deletes the marker push may write", async () => {
    const d = deps({ signedIn: false });
    let finish: () => void = () => {};
    d.clear.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          d.calls.push("clear");
          finish = resolve;
        }),
    );
    const done = runSignedOutCleanup(d);
    await vi.waitFor(() => expect(d.clear).toHaveBeenCalled());
    expect(d.startPush).not.toHaveBeenCalled();
    finish();
    await done;
    expect(d.calls).toEqual(["read", "broadcast", "clear", "push"]);
  });

  it("a clear that fails still goes on to push", async () => {
    const d = deps({ signedIn: false });
    d.clear.mockRejectedValue(new Error("quota"));
    expect(await runSignedOutCleanup(d)).toBe("cleared");
    expect(d.startPush).toHaveBeenCalled();
  });

  describe("the page was left before the answer came (signed in from this page meanwhile)", () => {
    it("asks again, and leaves everything alone if someone is now signed in", async () => {
      // The first answer comes from the mock below; the second from the list.
      const d = deps(signedIn);
      d.readSession.mockImplementationOnce(async () => {
        d.calls.push("read");
        d.leave();
        return { signedIn: false };
      });
      expect(await runSignedOutCleanup(d)).toBe("kept");
      expect(d.calls).toEqual(["read", "read"]);
    });

    it("asks again after an unknown answer too", async () => {
      const d = deps(signedIn);
      d.readSession.mockImplementationOnce(async () => {
        d.calls.push("read");
        d.leave();
        return null;
      });
      expect(await runSignedOutCleanup(d)).toBe("kept");
      expect(d.calls).toEqual(["read", "read"]);
    });

    it("clears if still signed out, or still unknown", async () => {
      for (const second of [{ signedIn: false } as SessionCheck, null]) {
        const d = deps({ signedIn: false }, second);
        d.leave();
        expect(await runSignedOutCleanup(d)).toBe("cleared");
        expect(d.calls).toEqual(["read", "read", "broadcast", "clear", "push"]);
      }
    });
  });
});
