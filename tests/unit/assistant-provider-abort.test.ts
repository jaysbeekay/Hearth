// Stopping an Assistant reply (#611) aborts the provider request in flight,
// not just the calls after it — both while waiting for the response and
// while its body is still streaming.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiProviderFetch } from "@/lib/ai/egressProxy";
import { callAnthropicChat } from "@/lib/ai/chat/providers/anthropic";
import { callGeminiChat } from "@/lib/ai/chat/providers/gemini";
import { callOllamaChat } from "@/lib/ai/chat/providers/ollama";
import { callOpenAiChat } from "@/lib/ai/chat/providers/openai";
import { callOpenRouterChat } from "@/lib/ai/chat/providers/openrouter";
import type { ChatProviderCall } from "@/lib/ai/chat/types";

vi.mock("@/lib/ai/egressProxy", () => ({ aiProviderFetch: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({
  getOllamaConfig: vi.fn(async () => ({ baseUrl: "http://ollama.test", model: "test-model" })),
}));

function abortError() {
  return new DOMException("aborted", "AbortError");
}

/** A request that never answers until its signal aborts. */
function hangingRequest(_url: string, init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    signal?.addEventListener("abort", () => {
      reject(abortError());
    });
  });
}

/** A response whose body never ends until the request's signal aborts. */
function neverEndingBody(_url: string, init?: RequestInit) {
  const signal = init?.signal;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener("abort", () => {
        controller.error(abortError());
      });
    },
  });
  return Promise.resolve(new Response(body, { status: 200 }));
}

const providers: [string, ChatProviderCall][] = [
  ["Anthropic", callAnthropicChat],
  ["Gemini", callGeminiChat],
  ["Ollama", callOllamaChat],
  ["OpenAI", callOpenAiChat],
  ["OpenRouter", callOpenRouterChat],
];

function startCall(call: ChatProviderCall, signal: AbortSignal) {
  return call({
    apiKey: "key",
    model: "model",
    system: "system",
    messages: [{ role: "user", content: "Hi" }],
    tools: [],
    signal,
  });
}

async function fetchSignal() {
  await vi.waitFor(() => {
    expect(aiProviderFetch).toHaveBeenCalledTimes(1);
  });
  return vi.mocked(aiProviderFetch).mock.calls[0][1]?.signal;
}

beforeEach(() => {
  vi.mocked(aiProviderFetch).mockReset();
});

describe.each(providers)("%s chat provider", (_name, call) => {
  it("aborts the request while waiting for a response", async () => {
    vi.mocked(aiProviderFetch).mockImplementation(hangingRequest);
    const stop = new AbortController();
    const result = startCall(call, stop.signal);
    const signal = await fetchSignal();
    stop.abort();

    await expect(result).resolves.toMatchObject({ ok: false });
    expect(signal?.aborted).toBe(true);
  });

  it("aborts the request while the response is still streaming", async () => {
    vi.mocked(aiProviderFetch).mockImplementation(neverEndingBody);
    const stop = new AbortController();
    const result = startCall(call, stop.signal);
    const signal = await fetchSignal();
    stop.abort();

    await expect(result).resolves.toMatchObject({ ok: false });
    expect(signal?.aborted).toBe(true);
  });
});
