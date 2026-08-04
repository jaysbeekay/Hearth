import { PROVIDER_TIMEOUT_MS, type ProviderCall } from "@/lib/ai/providers/types";
import { proxiedProviderUrl } from "@/lib/ai/egressProxy";

// Sends the raw PDF/image bytes to Anthropic's Messages API so Claude reads
// the document directly, rather than relying on the app's local OCR pass.
export const callAnthropic: ProviderCall = async ({ apiKey, model, buffer, mimeType, prompt }) => {
  const data = buffer.toString("base64");
  const documentBlock =
    mimeType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: mimeType, data } }
      : { type: "image", source: { type: "base64", media_type: mimeType, data } };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(proxiedProviderUrl("https://api.anthropic.com/v1/messages"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: [documentBlock, { type: "text", text: prompt }] }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    return json.content?.find((block) => block.type === "text")?.text ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};
