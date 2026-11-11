// /api/chat's response stream (#611): a turn that throws reports an error
// instead of ending as if it had finished; a client that goes away aborts
// the turn; and a new turn on a thread waits (briefly) for the previous
// turn on it to finish saving.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatTurnStream } from "@/lib/chat/turnStream";
import { beginThreadTurn, waitForThreadTurn } from "@/lib/chat/threadTurns";
import { readChatStream } from "@/lib/assistant/readChatStream";
import type { ChatStreamEvent } from "@/lib/chat/streamEvents";

async function readAll(stream: ReadableStream<Uint8Array>) {
  const events: ChatStreamEvent[] = [];
  const outcome = await readChatStream(stream, (event) => {
    events.push(event);
  });
  return { events, outcome };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("createChatTurnStream", () => {
  it("streams the turn's events and finishes", async () => {
    const stream = createChatTurnStream(new AbortController().signal, async (emit) => {
      emit({ type: "delta", text: "Hi" });
      emit({ type: "done", threadId: "t1" });
    });
    const { events, outcome } = await readAll(stream);
    expect(events.map((e) => e.type)).toEqual(["delta", "done"]);
    expect(outcome).toEqual({ kind: "done", threadId: "t1" });
  });

  it("reports an error, and logs it, when the turn throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const stream = createChatTurnStream(new AbortController().signal, async (emit) => {
      emit({ type: "delta", text: "Partly" });
      throw new Error("database is locked");
    });
    const { outcome } = await readAll(stream);
    expect(outcome.kind).toBe("error");
    expect(log).toHaveBeenCalled();
  });

  it("aborts the turn when the request is aborted", async () => {
    const request = new AbortController();
    let turnSignal: AbortSignal | undefined;
    const stream = createChatTurnStream(request.signal, async (_emit, signal) => {
      turnSignal = signal;
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          resolve();
        });
      });
    });
    const reader = stream.getReader();
    request.abort();
    await reader.read();
    expect(turnSignal?.aborted).toBe(true);
  });

  it("aborts the turn when the reader cancels the stream", async () => {
    let turnSignal: AbortSignal | undefined;
    const stream = createChatTurnStream(new AbortController().signal, async (_emit, signal) => {
      turnSignal = signal;
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          resolve();
        });
      });
    });
    await stream.cancel();
    expect(turnSignal?.aborted).toBe(true);
  });

  it("doesn't report an error when a stopped turn throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = new AbortController();
    request.abort();
    const stream = createChatTurnStream(request.signal, async () => {
      throw new Error("aborted");
    });
    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.done).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("readChatStream", () => {
  function streamOf(lines: string[]) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(new TextEncoder().encode(line));
        controller.close();
      },
    });
  }

  it("treats a stream that ends without done as cut off", async () => {
    const { outcome } = await readAll(
      streamOf([`data: ${JSON.stringify({ type: "delta", text: "Half" })}\n\n`]),
    );
    expect(outcome).toEqual({ kind: "cut_off" });
  });

  it("returns the error a stream reports", async () => {
    const { outcome } = await readAll(
      streamOf([`data: ${JSON.stringify({ type: "error", message: "Bad key" })}\n\n`]),
    );
    expect(outcome).toEqual({ kind: "error", message: "Bad key" });
  });
});

describe("thread turns", () => {
  it("lets a new turn start straight away when none is in flight", async () => {
    await expect(waitForThreadTurn("idle-thread", 1000)).resolves.toBeUndefined();
  });

  it("waits for the thread's previous turn to finish", async () => {
    const end = beginThreadTurn("busy-thread");
    let waited = false;
    const wait = waitForThreadTurn("busy-thread", 5000).then(() => {
      waited = true;
    });
    await Promise.resolve();
    expect(waited).toBe(false);
    end();
    await wait;
    expect(waited).toBe(true);
  });

  it("stops waiting after the time limit", async () => {
    vi.useFakeTimers();
    beginThreadTurn("stuck-thread");
    let waited = false;
    const wait = waitForThreadTurn("stuck-thread", 3000).then(() => {
      waited = true;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(waited).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await wait;
    expect(waited).toBe(true);
  });

  it("only waits on other threads' turns for their own thread", async () => {
    const end = beginThreadTurn("thread-a");
    await expect(waitForThreadTurn("thread-b", 1000)).resolves.toBeUndefined();
    end();
  });
});
