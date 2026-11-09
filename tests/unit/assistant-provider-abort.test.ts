// Stopping an Assistant reply (#611) aborts the provider request in flight,
// not just the calls after it.
import { describe, expect, it, vi } from "vitest";
import { aiProviderFetch } from "@/lib/ai/egressProxy";
import { callAnthropicChat } from "@/lib/ai/chat/providers/anthropic";
import { callGeminiChat } from "@/lib/ai/chat/providers/gemini";
import { callOllamaChat } from "@/lib/ai/chat/providers/ollama";
import { callOpenAiChat } from "@/lib/ai/chat/providers/openai";
import { callOpenRouterChat } from "@/lib/ai/chat/providers/openrouter";
import type { ChatProviderCall } from "@/lib/ai/chat/types";

vi.mock("@/lib/ai/egressProxy", () => ({ aiProviderFetch: vi.fn() }));

// A provider request that never answers until its signal aborts.
vi.mocked(aiProviderFetch).mockImplementation(
  (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    }),
);

const providers: [string, ChatProviderCall][] = [
  ["Anthropic", callAnthropicChat],
  ["Gemini", callGeminiChat],
  ["Ollama", callOllamaChat],
  ["OpenAI", callOpenAiChat],
  ["OpenRouter", callOpenRouterChat],
];

describe.each(providers)("%s chat provider", (_name, call) => {
  it("aborts the request when the reply is stopped", async () => {
    const stop = new AbortController();
    const result = call({
      apiKey: "key",
      model: "model",
      system: "system",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
      signal: stop.signal,
    });
    stop.abort();
    await expect(result).resolves.toMatchObject({ ok: false });
  });
});
