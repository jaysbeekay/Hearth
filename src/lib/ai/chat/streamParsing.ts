// Shared low-level stream readers for the chat providers' streaming APIs.
// Two wire formats show up across the 5 providers: `text/event-stream` (SSE
// — Anthropic, OpenAI, Gemini, OpenRouter) and newline-delimited JSON
// (Ollama). Both are read incrementally from a fetch Response body so text
// deltas can be forwarded to the client as they arrive, rather than only
// after the whole response has downloaded.

// Reads an SSE body, calling `onEvent` with each event's raw `data:` payload
// (a JSON string, or the literal "[DONE]" some providers send as a sentinel).
// Multi-line `data:` fields within one event are joined with "\n" per the
// SSE spec; non-data fields (`event:`, `id:`, comments) are ignored since
// every provider here also encodes an equivalent `type`/discriminator inside
// the JSON payload itself.
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (data: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLines = rawEvent
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart());
        if (dataLines.length > 0) onEvent(dataLines.join("\n"));
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Reads a newline-delimited JSON body (Ollama's streaming format), calling
// `onLine` with each complete line's raw text.
export async function readNdjsonStream(
  body: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) onLine(line);
      }
    }
    const trailing = buffer.trim();
    if (trailing) onLine(trailing);
  } finally {
    reader.releaseLock();
  }
}
