// The events /api/chat streams to the Assistant, one per SSE `data:` line.
// Client-safe: shared by the route, the turn loop and useAssistantChat.
//
// `thread` comes first, so a reply stopped before `done` still knows which
// thread it belongs to. `delta` events carry incremental text as it's
// generated (across every round, including any preamble text a round produces
// before invoking a tool). `tool_call` is purely informational, so the UI can
// show which tool is being used. `proposed_action` carries a guarded write the
// model wants to make — the client renders it as a confirm/cancel card;
// nothing is written to the database until the user confirms it there.
export type ChatStreamEvent =
  | { type: "thread"; threadId: string }
  | { type: "delta"; text: string }
  | { type: "tool_call"; name: string }
  | {
      type: "proposed_action";
      id: string;
      entity: "contract" | "product";
      operation: "create" | "update";
      entityId?: string;
      label?: string;
      data: Record<string, unknown>;
      displayValues?: Record<string, string>;
      currentValues?: Record<string, unknown>;
      warnings?: Record<string, string[]>;
    }
  | { type: "error"; message: string }
  | { type: "done"; threadId: string };

/** Marks a reply the user stopped, so it isn't mistaken for a complete answer. */
export const STOPPED_REPLY_NOTE = "(stopped)";

/** A stopped reply's text with the stopped note after it. */
export function markReplyStopped(text: string): string {
  const trimmed = text.trimEnd();
  return trimmed ? `${trimmed}\n\n${STOPPED_REPLY_NOTE}` : STOPPED_REPLY_NOTE;
}
