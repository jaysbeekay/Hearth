import { readSseStream } from "@/lib/ai/chat/streamParsing";
import type { ChatStreamEvent } from "@/lib/chat/streamEvents";

/** How an Assistant reply's stream ended. */
export type ChatStreamOutcome =
  | { kind: "done"; threadId: string }
  | { kind: "error"; message: string }
  /** The stream ended without `done` or `error`: the turn didn't finish. */
  | { kind: "cut_off" };

/**
 * Reads /api/chat's event stream, passing each event to `onEvent`, and says
 * how it ended. Throws if the read itself fails, including when the request
 * is aborted.
 */
export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<ChatStreamOutcome> {
  let outcome: ChatStreamOutcome = { kind: "cut_off" };
  await readSseStream(body, (data) => {
    let event: ChatStreamEvent;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (event.type === "done") outcome = { kind: "done", threadId: event.threadId };
    else if (event.type === "error") outcome = { kind: "error", message: event.message };
    onEvent(event);
  });
  return outcome;
}
