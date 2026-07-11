import { getOllamaConfig } from "@/lib/appSettings";
import { PROVIDER_TIMEOUT_MS, type ProviderCall } from "@/lib/ai/providers/types";

// Ollama has no cloud-hosted document reader like the other BYOK providers —
// it routes through the shared local server configured in Settings > System
// (getOllamaConfig()), not a per-user API key. Only image mimeTypes are
// supported since a text-generation model can't read a PDF's bytes directly;
// PDFs fall through to the existing local-OCR extraction path instead.
export const callOllama: ProviderCall = async ({ model, buffer, mimeType, prompt }) => {
  if (!mimeType.startsWith("image/")) return null;

  const ollama = await getOllamaConfig();
  if (!ollama.baseUrl) return null;

  const data = buffer.toString("base64");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(`${ollama.baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollama.model || model,
        prompt,
        images: [data],
        format: "json",
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const json = (await res.json()) as { response?: string };
    return json.response ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};
