import { env, isAiEgressProxyConfigured } from "@/lib/env";

// Optional integration point for a local agent-firewall proxy (e.g.
// https://github.com/luckyPipewrench/pipelock) sitting between Hearth and
// the AI providers it calls for document extraction and the household chat
// assistant. When AI_EGRESS_PROXY_URL is configured, every provider request
// is routed through the firewall's mediated-fetch endpoint instead of the
// provider directly, so a prompt-injection attempt trying to smuggle
// exfiltration instructions into the model's own outbound call gets
// inspected before it leaves the network. This complements — it doesn't
// replace — the prompt-level hardening in fieldExtraction.ts and the chat
// assistant's system prompt.
export function proxiedProviderUrl(targetUrl: string): string {
  if (!isAiEgressProxyConfigured()) return targetUrl;
  const base = env.aiEgressProxy.url.replace(/\/$/, "");
  return `${base}/fetch?url=${encodeURIComponent(targetUrl)}`;
}
