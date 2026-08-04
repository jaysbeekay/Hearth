import { PROVIDER_TIMEOUT_MS, type ProviderCall } from "@/lib/ai/providers/types";
import { proxiedProviderUrl } from "@/lib/ai/egressProxy";

// Sends the raw PDF/image bytes to OpenAI's Responses API so the model
// reads the document directly, rather than relying on local OCR.
export const callOpenAi: ProviderCall = async ({ apiKey, model, buffer, mimeType, prompt }) => {
  const data = buffer.toString("base64");
  const fileBlock =
    mimeType === "application/pdf"
      ? { type: "input_file", filename: "document.pdf", file_data: `data:${mimeType};base64,${data}` }
      : { type: "input_image", image_url: `data:${mimeType};base64,${data}` };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(proxiedProviderUrl("https://api.openai.com/v1/responses"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [{ role: "user", content: [fileBlock, { type: "input_text", text: prompt }] }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const json = (await res.json()) as {
      output?: { content?: { type: string; text?: string }[] }[];
    };
    for (const item of json.output ?? []) {
      const textBlock = item.content?.find((block) => block.type === "output_text");
      if (textBlock?.text) return textBlock.text;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};
