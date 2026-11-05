import { readFileSync } from "node:fs";
import { rootCertificates } from "node:tls";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { env, isAiEgressProxyConfigured } from "@/lib/env";

// Optional integration point for a local agent-firewall proxy (e.g.
// Pipelock, https://github.com/pipelab-org/pipelock) sitting between Hearth
// and the AI providers it calls for document extraction and the household
// chat assistant. When AI_EGRESS_PROXY_URL is configured, every provider
// request goes out through that proxy as a standard HTTP forward proxy
// (CONNECT for https, absolute-URI requests for plain-http Ollama), so the
// firewall can inspect it before it leaves the network. This complements,
// and doesn't replace, the prompt-level hardening in the extraction prompts
// and the assistant's system prompt.
//
// Pipelock's /fetch endpoint, which this used to target, only accepts GET
// and returns extracted page text, so it can't carry a provider's POST API
// call (#559). Only provider calls use the proxy: the rest of Hearth's
// outbound traffic (price feeds, geocoding, email) is unaffected.
//
// Without AI_EGRESS_PROXY_CA_CERT the proxy only sees the hostname of each
// https call (a CONNECT tunnel). To let it scan request and response
// bodies, enable TLS interception in the proxy and point
// AI_EGRESS_PROXY_CA_CERT at its CA certificate; Hearth then trusts that CA
// for provider calls only, on top of the system roots.

let cachedAgent: ProxyAgent | null = null;

function egressAgent(): ProxyAgent {
  if (cachedAgent) return cachedAgent;
  const caFile = env.aiEgressProxy.caCertFile;
  const ca = caFile ? [...rootCertificates, readFileSync(caFile, "utf8")] : undefined;
  cachedAgent = new ProxyAgent({
    uri: env.aiEgressProxy.url,
    // Plain-http targets (a LAN Ollama) are sent as absolute-URI requests so
    // the proxy reads them in the clear instead of tunnelling them blind.
    proxyTunnel: false,
    ...(ca ? { requestTls: { ca } } : {}),
  });
  return cachedAgent;
}

// Drop-in for fetch() on every outbound AI provider call. With no proxy
// configured it is exactly the global fetch, as before.
export async function aiProviderFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!isAiEgressProxyConfigured()) return fetch(url, init);
  const res = await undiciFetch(url, {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: egressAgent(),
  });
  return res as unknown as Response;
}

// For tests: forget the cached agent after changing the proxy env.
export function resetAiEgressAgentForTests() {
  cachedAgent = null;
}
