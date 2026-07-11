import { PROVIDER_TIMEOUT_MS, type ProviderCall } from "@/lib/ai/providers/types";

// OpenRouter mirrors OpenAI's chat/completions shape. PDF support depends on
// the routed model, so this sends the "file" content-part OpenRouter
// documents for PDF-capable models; images use the standard image_url part.
export const callOpenRouter: ProviderCall = async ({ apiKey, model, buffer, mimeType, prompt }) => {
  const data = buffer.toString("base64");
  const contentBlock =
    mimeType === "application/pdf"
      ? { type: "file", file: { filename: "document.pdf", file_data: `data:${mimeType};base64,${data}` } }
      : { type: "image_url", image_url: { url: `data:${mimeType};base64,${data}` } };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: [contentBlock, { type: "text", text: prompt }] }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};
