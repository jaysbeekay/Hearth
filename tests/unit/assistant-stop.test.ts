// Stopping an Assistant reply (#611): once the client goes away, the turn
// makes no further provider calls or tool rounds, saves the text already
// streamed marked as stopped, and saves nothing if nothing had streamed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser } from "../helpers/testDb";
import { runChatTurn, type ChatTurnProvider } from "@/lib/chat/chatTurn";
import { markReplyStopped, type ChatStreamEvent } from "@/lib/chat/streamEvents";
import type { ChatProviderResult, ChatTurn } from "@/lib/ai/chat/types";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const db = setupTestDb();

let threadId: string;

beforeEach(async () => {
  const user = await createTestUser();
  const thread = await db.prisma.chatThread.create({
    data: { createdById: user.id, title: "Test" },
  });
  threadId = thread.id;
});

const toolRound: ChatProviderResult = {
  ok: true,
  text: null,
  toolCalls: [{ id: "call-1", name: "list_contracts", input: {} }],
};

/**
 * A stub provider that counts its calls. Each call plays the next scripted
 * step: it streams `deltas`, runs `during` (where a test aborts), then
 * resolves with `result` — or, like a real provider whose fetch was aborted,
 * with a network error if the signal fired.
 */
function stubProvider(
  steps: { deltas?: string[]; during?: () => void; result: ChatProviderResult }[],
) {
  const calls: ChatTurn[][] = [];
  const provider: ChatTurnProvider = async (messages, onDelta, signal) => {
    const step = steps[calls.length];
    calls.push([...messages]);
    if (!step) throw new Error("Provider called more times than scripted");
    for (const delta of step.deltas ?? []) onDelta(delta);
    step.during?.();
    if (signal.aborted) return { ok: false, errorKind: "network", message: "aborted" };
    return step.result;
  };
  return { provider, calls };
}

async function assistantRows() {
  return db.prisma.chatMessage.findMany({
    where: { threadId, role: "ASSISTANT" },
    orderBy: { createdAt: "asc" },
  });
}

function run(provider: ChatTurnProvider, signal: AbortSignal, runTool = vi.fn(async () => "[]")) {
  const events: ChatStreamEvent[] = [];
  const done = runChatTurn({
    threadId,
    messages: [{ role: "user", content: "Hi" }],
    signal,
    emit: (event) => {
      events.push(event);
    },
    callProvider: provider,
    runTool,
  });
  return { done, events, runTool };
}

describe("runChatTurn", () => {
  it("completes a turn normally when not stopped", async () => {
    const { provider, calls } = stubProvider([
      { result: toolRound },
      { deltas: ["All ", "done."], result: { ok: true, text: "All done.", toolCalls: [] } },
    ]);
    const { done, events } = run(provider, new AbortController().signal);
    await done;

    expect(calls).toHaveLength(2);
    expect(events.at(-1)).toEqual({ type: "done", threadId });
    expect((await assistantRows()).at(-1)?.content).toBe("All done.");
  });

  it("makes no further provider calls once stopped during a tool round", async () => {
    const abort = new AbortController();
    const { provider, calls } = stubProvider([
      { result: toolRound },
      { result: { ok: true, text: "never", toolCalls: [] } },
    ]);
    const runTool = vi.fn(async () => {
      abort.abort();
      return "[]";
    });
    const { done, events } = run(provider, abort.signal, runTool);
    await done;

    expect(calls).toHaveLength(1);
    // The round's tool results are kept so the history stays replayable.
    expect(await db.prisma.chatMessage.count({ where: { threadId, role: "TOOL" } })).toBe(1);
    expect(events.some((e) => e.type === "done" || e.type === "error")).toBe(false);
  });

  it("saves the streamed text marked as stopped when stopped mid-reply", async () => {
    const abort = new AbortController();
    const { provider, calls } = stubProvider([
      { deltas: ["Your next ", "renewal is"], during: () => abort.abort(), result: toolRound },
    ]);
    const { done, events } = run(provider, abort.signal);
    await done;

    expect(calls).toHaveLength(1);
    const rows = await assistantRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe(markReplyStopped("Your next renewal is"));
    expect(rows[0].toolCalls).toBeNull();
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("saves nothing when stopped before any text streamed", async () => {
    const abort = new AbortController();
    const { provider } = stubProvider([{ during: () => abort.abort(), result: toolRound }]);
    const { done } = run(provider, abort.signal);
    await done;

    expect(await assistantRows()).toHaveLength(0);
  });

  it("does not call the provider at all when already stopped", async () => {
    const abort = new AbortController();
    abort.abort();
    const { provider, calls } = stubProvider([{ result: toolRound }]);
    const { done } = run(provider, abort.signal);
    await done;

    expect(calls).toHaveLength(0);
    expect(await assistantRows()).toHaveLength(0);
  });

  it("does not show a proposal card once stopped", async () => {
    const abort = new AbortController();
    const { provider } = stubProvider([
      {
        result: {
          ok: true,
          text: null,
          toolCalls: [{ id: "call-1", name: "propose_contract", input: {} }],
        },
      },
    ]);
    const runTool = vi.fn(async () => {
      abort.abort();
      return JSON.stringify({ proposed: true, entity: "contract", operation: "create", data: {} });
    });
    const { done, events } = run(provider, abort.signal, runTool);
    await done;

    expect(events.some((e) => e.type === "proposed_action")).toBe(false);
  });

  it("marks the reply stopped when earlier rounds already streamed text", async () => {
    const abort = new AbortController();
    const { provider, calls } = stubProvider([
      { deltas: ["Let me check."], result: { ...toolRound, text: "Let me check." } },
      { during: () => abort.abort(), result: { ok: true, text: "never", toolCalls: [] } },
    ]);
    const { done } = run(provider, abort.signal);
    await done;

    expect(calls).toHaveLength(2);
    const rows = await assistantRows();
    expect(rows.map((r) => r.content)).toEqual(["Let me check.", markReplyStopped("")]);
  });
});
