import type { ChatStreamEvent } from "@/lib/chat/streamEvents";

const TURN_FAILED_MESSAGE = "Something went wrong while answering. Try again.";

function sseFrame(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * The SSE response stream for one Assistant turn. Each event is JSON-encoded
 * on its own `data:` line.
 *
 * The turn's signal aborts when the user stops the reply, closes the panel or
 * leaves: `requestSignal` fires when the client disconnects, and the stream's
 * cancel() when the reader gives up on it. A turn that throws is logged and
 * reported as an error event, unless it was stopped, so the client doesn't
 * take a failed turn for a finished one.
 */
export function createChatTurnStream(
  requestSignal: AbortSignal,
  run: (emit: (event: ChatStreamEvent) => void, signal: AbortSignal) => Promise<void>,
): ReadableStream<Uint8Array> {
  const stop = new AbortController();
  const forwardRequestAbort = () => {
    stop.abort();
  };
  if (requestSignal.aborted) stop.abort();
  else requestSignal.addEventListener("abort", forwardRequestAbort, { once: true });
  let closed = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ChatStreamEvent) => {
        if (closed || stop.signal.aborted) return;
        try {
          controller.enqueue(sseFrame(event));
        } catch {
          // The client went away between the check and the write.
          closed = true;
        }
      };

      try {
        await run(emit, stop.signal);
      } catch (error) {
        if (!stop.signal.aborted) {
          console.error("Assistant turn failed", error);
          emit({ type: "error", message: TURN_FAILED_MESSAGE });
        }
      } finally {
        requestSignal.removeEventListener("abort", forwardRequestAbort);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
      stop.abort();
    },
  });
}
