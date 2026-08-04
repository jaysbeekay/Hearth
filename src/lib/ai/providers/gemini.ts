import { PROVIDER_TIMEOUT_MS, type ProviderCall } from "@/lib/ai/providers/types";
import { proxiedProviderUrl } from "@/lib/ai/egressProxy";

// Sends the raw PDF/image bytes to Google's Generative Language API so
// Gemini reads the document directly, rather than relying on local OCR.
export const callGemini: ProviderCall = async ({ apiKey, model, buffer, mimeType, prompt }) => {
  const data = buffer.toString("base64");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(
      proxiedProviderUrl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ inline_data: { mime_type: mimeType, data } }, { text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
        signal: controller.signal,
      },
    );
    if (!res.ok) return null;

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};
