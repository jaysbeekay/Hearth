import dns from "node:dns/promises";
import net from "node:net";

// Guards for outbound requests to addresses an administrator can configure:
// webhook endpoints, the ntfy server, the Ollama base URL, S3 endpoints and
// the geocoding/barcode/flight-status services (#167).
//
// A blanket "block all private and loopback addresses" — the usual SSRF
// posture — would be wrong for this product. Hearth is self-hosted, and its
// documented integrations are LAN services: the webhook form's own
// placeholder is https://homeassistant.local:8123/..., docker-compose ships a
// self-hosted ntfy at http://ntfy:80, and the README points Ollama at
// http://host.docker.internal:11434. Blocking those by default would break
// working installs on upgrade to defend against a threat — a malicious
// administrator — who already has the run of the instance.
//
// So the split is:
//   * Always refused, with no legitimate use here: non-HTTP(S) schemes, cloud
//     instance-metadata addresses, link-local, multicast, unspecified and
//     broadcast addresses.
//   * Private and loopback ranges: allowed by default, refusable by setting
//     BLOCK_PRIVATE_NETWORK_TARGETS=true for instances that don't integrate
//     with anything on their own network.
//
// Known limitation: the DNS answer is validated and then a normal fetch()
// re-resolves the name, so a hostname that flips between a public and a
// private address between the two lookups is not caught. Closing that needs a
// connection-pinning HTTP agent (undici isn't a direct dependency here). The
// window is narrow and the caller is admin-supplied, but it is not zero, and
// it is deliberately not claimed as fixed.

export class UnsafeOutboundUrlError extends Error {}

const METADATA_ADDRESSES = new Set([
  "169.254.169.254", // AWS / GCP / Azure / DigitalOcean
  "100.100.100.200", // Alibaba Cloud
  "192.0.0.192", // Oracle Cloud
  "fd00:ec2::254", // AWS IPv6
]);

function ipv4Parts(address: string): number[] | null {
  if (!net.isIPv4(address)) return null;
  return address.split(".").map(Number);
}

function isPrivateIpv4([a, b]: number[]): boolean {
  if (a === 10) return true; // 10/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  return false;
}

type Classification = "ok" | "private" | "blocked";

function classifyIpv4(address: string): Classification {
  const parts = ipv4Parts(address);
  if (!parts) return "blocked";
  const [a, b] = parts;

  if (METADATA_ADDRESSES.has(address)) return "blocked";
  if (a === 0) return "blocked"; // 0.0.0.0/8 "this network"
  if (a === 169 && b === 254) return "blocked"; // link-local, incl. metadata
  if (a >= 224) return "blocked"; // multicast (224/4) + reserved (240/4)
  if (a === 127) return "private"; // loopback
  if (isPrivateIpv4(parts)) return "private";
  return "ok";
}

function classifyIpv6(address: string): Classification {
  const lower = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (METADATA_ADDRESSES.has(lower)) return "blocked";
  if (lower === "::" || lower === "::0") return "blocked"; // unspecified
  if (lower.startsWith("ff")) return "blocked"; // multicast
  if (lower.startsWith("fe8") || lower.startsWith("fe9")) return "blocked"; // link-local
  if (lower.startsWith("fea") || lower.startsWith("feb")) return "blocked";

  // IPv4-mapped (::ffff:a.b.c.d) — classify by the embedded IPv4 so the rules
  // above can't be sidestepped by writing an address in v6 form.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return classifyIpv4(mapped[1]);

  if (lower === "::1") return "private"; // loopback
  if (lower.startsWith("fc") || lower.startsWith("fd")) return "private"; // unique-local
  return "ok";
}

export function classifyAddress(address: string): Classification {
  if (net.isIPv4(address)) return classifyIpv4(address);
  if (net.isIPv6(address)) return classifyIpv6(address);
  return "blocked";
}

export interface OutboundUrlOptions {
  // Defaults to the inverse of BLOCK_PRIVATE_NETWORK_TARGETS, i.e. private
  // targets are permitted unless the operator opts out.
  allowPrivate?: boolean;
}

function privateAllowedByDefault(): boolean {
  return process.env.BLOCK_PRIVATE_NETWORK_TARGETS !== "true";
}

// Validates a URL and every address it resolves to. Returns the parsed URL so
// callers can use the normalised form.
export async function assertSafeOutboundUrl(
  rawUrl: string,
  options: OutboundUrlOptions = {},
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeOutboundUrlError("That doesn't look like a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeOutboundUrlError("Only http:// and https:// URLs are allowed.");
  }

  const allowPrivate = options.allowPrivate ?? privateAllowedByDefault();
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  // A literal address needs no lookup — and must not get one, or a hostile
  // "hostname" that happens to look like an IP would skip the check.
  const addresses: string[] = net.isIP(hostname)
    ? [hostname]
    : (await resolveOrThrow(hostname)).map((entry) => entry.address);

  if (addresses.length === 0) {
    throw new UnsafeOutboundUrlError(`Couldn't resolve ${parsed.hostname}.`);
  }

  for (const address of addresses) {
    const classification = classifyAddress(address);
    if (classification === "blocked") {
      throw new UnsafeOutboundUrlError(
        `${parsed.hostname} resolves to ${address}, which isn't a permitted destination.`,
      );
    }
    if (classification === "private" && !allowPrivate) {
      throw new UnsafeOutboundUrlError(
        `${parsed.hostname} resolves to the private address ${address}, and this instance ` +
          "is configured to refuse private network targets.",
      );
    }
  }

  return parsed;
}

async function resolveOrThrow(hostname: string) {
  try {
    return await dns.lookup(hostname, { all: true });
  } catch {
    throw new UnsafeOutboundUrlError(`Couldn't resolve ${hostname}.`);
  }
}

export interface SafeFetchOptions extends OutboundUrlOptions {
  timeoutMs?: number;
  // Caps how much of the response body is read. A configured endpoint that
  // streams indefinitely would otherwise hold memory for as long as it likes.
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

// fetch() with the destination validated first, a hard timeout, and a bounded
// response body. Returns the response plus the already-read body text, since
// enforcing the size cap means consuming the stream here.
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<{ response: Response; body: string }> {
  const url = await assertSafeOutboundUrl(rawUrl, options);

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await readCapped(response, maxBytes);
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new UnsafeOutboundUrlError(
        `Response from ${response.url || "the server"} exceeded ${maxBytes} bytes.`,
      );
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}
