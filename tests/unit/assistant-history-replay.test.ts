// Replaying a thread to the provider (#611): a stopped turn can leave an
// assistant tool call without its result, or rows saved out of order. The
// replay must still pair every tool call with its result, and must not
// present the "(stopped)" note as the model's own words.
import { describe, expect, it } from "vitest";
import { toReplayTurns, STOPPED_REPLY_REPLAY_NOTE, type ReplayRow } from "@/lib/chat/history";
import { markReplyStopped } from "@/lib/chat/streamEvents";

let clock = 0;
function row(
  partial: Pick<ReplayRow, "role" | "content"> & Partial<Omit<ReplayRow, "createdAt">>,
): ReplayRow {
  clock += 1;
  return {
    toolCalls: partial.toolCalls ?? null,
    toolCallId: partial.toolCallId ?? null,
    toolName: partial.toolName ?? null,
    role: partial.role,
    content: partial.content,
    createdAt: new Date(clock * 1000),
  };
}

const call = (id: string) => ({ id, name: "list_contracts", input: {} });

describe("toReplayTurns", () => {
  it("replays a normal turn unchanged", () => {
    const turns = toReplayTurns([
      row({ role: "USER", content: "Hi" }),
      row({ role: "ASSISTANT", content: "", toolCalls: JSON.stringify([call("a")]) }),
      row({ role: "TOOL", content: "[]", toolCallId: "a", toolName: "list_contracts" }),
      row({ role: "ASSISTANT", content: "None." }),
    ]);
    expect(turns).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "", toolCalls: [call("a")] },
      { role: "tool", toolCallId: "a", name: "list_contracts", content: "[]" },
      { role: "assistant", content: "None." },
    ]);
  });

  it("drops tool calls that have no saved result", () => {
    const turns = toReplayTurns([
      row({ role: "USER", content: "Hi" }),
      row({ role: "ASSISTANT", content: "Checking.", toolCalls: JSON.stringify([call("a"), call("b")]) }),
      row({ role: "TOOL", content: "[]", toolCallId: "a", toolName: "list_contracts" }),
      row({ role: "USER", content: "Next" }),
    ]);
    expect(turns).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Checking.", toolCalls: [call("a")] },
      { role: "tool", toolCallId: "a", name: "list_contracts", content: "[]" },
      { role: "user", content: "Next" },
    ]);
  });

  it("drops an assistant tool-call row with no results and no text", () => {
    const turns = toReplayTurns([
      row({ role: "USER", content: "Hi" }),
      row({ role: "ASSISTANT", content: "", toolCalls: JSON.stringify([call("a")]) }),
      row({ role: "USER", content: "Next" }),
    ]);
    expect(turns).toEqual([
      { role: "user", content: "Hi" },
      { role: "user", content: "Next" },
    ]);
  });

  it("drops a tool result whose call isn't in the history", () => {
    const turns = toReplayTurns([
      row({ role: "TOOL", content: "[]", toolCallId: "gone", toolName: "list_contracts" }),
      row({ role: "ASSISTANT", content: "None." }),
      row({ role: "USER", content: "Next" }),
    ]);
    expect(turns).toEqual([
      { role: "assistant", content: "None." },
      { role: "user", content: "Next" },
    ]);
  });

  it("keeps each tool result right after its call even when saved after a later message", () => {
    const turns = toReplayTurns([
      row({ role: "USER", content: "Hi" }),
      row({ role: "ASSISTANT", content: "", toolCalls: JSON.stringify([call("a")]) }),
      row({ role: "USER", content: "Next" }),
      row({ role: "TOOL", content: "[]", toolCallId: "a", toolName: "list_contracts" }),
      row({ role: "ASSISTANT", content: markReplyStopped("") }),
    ]);
    expect(turns.slice(0, 3)).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "", toolCalls: [call("a")] },
      { role: "tool", toolCallId: "a", name: "list_contracts", content: "[]" },
    ]);
    expect(turns).toHaveLength(5);
  });

  it("replays a stopped reply with a neutral note, not the (stopped) marker", () => {
    const turns = toReplayTurns([
      row({ role: "USER", content: "Hi" }),
      row({ role: "ASSISTANT", content: markReplyStopped("Your next renewal is") }),
    ]);
    expect(turns[1]).toEqual({
      role: "assistant",
      content: `Your next renewal is\n\n${STOPPED_REPLY_REPLAY_NOTE}`,
    });
    expect(turns[1].content).not.toContain("(stopped)");
  });

  it("replays a bare stopped marker as just the note", () => {
    const turns = toReplayTurns([row({ role: "ASSISTANT", content: markReplyStopped("") })]);
    expect(turns).toEqual([{ role: "assistant", content: STOPPED_REPLY_REPLAY_NOTE }]);
  });
});
