import dns from "node:dns/promises";
import net from "node:net";

// Guards for outbound requests to destinations an administrator configures:
// webhook endpoints, the ntfy server and the Ollama base URL (#167).
//
// The guiding constraint is that this app is self-hosted and its integrations
// live on the operator's own network. Bare IP addresses and local hostnames
// are first-class, supported destinations, not suspicious ones:
//
//   * https://192.168.1.50:8123        — Home Assistant by LAN IP
//   * https://homeassistant.local:8123 — the webhook form's own placeholder
//   * http://ntfy:80                   — the ntfy service in docker-compose
//   * http://host.docker.internal:11434 and http://localhost:11434 — Ollama
//
// So the policy is narrow on purpose. Only two things are refused outright:
// schemes that aren't HTTP(S), and the cloud instance-metadata addresses,
// which have no legitimate use from this app and are the actual prize in an
// SSRF. Everything else — every private range, loopback, link-local/APIPA,
// carrier-grade NAT, and any hostname at all — is permitted.
//
// Operators who genuinely have no local integrations can set
// BLOCK_PRIVATE_NETWORK_TARGETS=true to refuse local destinations as well.
// It is off by default, because turning it on breaks the setups above.
//
// A name that doesn't resolve is NOT treated as a failure. Resolution is
// advisory here: `.local` names need mDNS, which the Alpine runtime image
// doesn't have, and a service may simply be down when its webhook is saved.
// Refusing those would make the app's own suggested configuration
// unsaveable. An unresolvable host is passed through and fails, if it fails,
// at connect time with an ordinary network error.
//
// Known limitation, deliberately not claimed as fixed: addresses are checked
// and then fetch() resolves the name again, so a host that flips between a
// permitted and a metadata address between the two lookups isn't caught.
// Closing that needs a connection-pinning agent; undici isn't a direct
// dependency here.

export class UnsafeOutboundUrlError extends Error {}

// Specific, well-known instance-metadata endpoints. Deliberately an exact-
// match list rather than a range: blocking all of 169.254.0.0/16 would also
// catch APIPA addresses, which are ordinary self-assigned addresses on a real
// network.
const METADATA_ADDRESSES = new Set([
  "169.254.169.254", // AWS, GCP, Azure, DigitalOcean, Hetzner
  "169.254.170.2", // AWS ECS task metadata
  "100.100.100.200", // Alibaba Cloud
  "192.0.0.192", // Oracle Cloud
  "fd00:ec2::254", // AWS IPv6
]);

export type AddressClass = "metadata" | "local" | "public";

function ipv4Parts(address: string): number[] | null {
  if (!net.isIPv4(address)) return null;
  return address.split(".").map(Number);
}

function classifyIpv4(address: string): AddressClass {
  if (METADATA_ADDRESSES.has(address)) return "metadata";

  const parts = ipv4Parts(address);
  if (!parts) return "public";
  const [a, b] = parts;

  if (a === 10) return "local"; // 10/8
  if (a === 127) return "local"; // loopback
  if (a === 172 && b >= 16 && b <= 31) return "local"; // 172.16/12
  if (a === 192 && b === 168) return "local"; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return "local"; // 100.64/10 CGNAT, e.g. Tailscale
  if (a === 169 && b === 254) return "local"; // link-local / APIPA
  if (a === 0) return "local"; // 0.0.0.0 — "this host" on some stacks
  if (a >= 224) return "local"; // multicast / reserved — never routable anyway

  return "public";
}

function classifyIpv6(address: string): AddressClass {
  // Strip brackets and any zone index (fe80::1%eth0).
  const lower = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (METADATA_ADDRESSES.has(lower)) return "metadata";

  // IPv4-mapped — classify by the embedded address so the metadata list
  // can't be sidestepped by spelling it in v6 form. Both spellings matter:
  // the dotted form ::ffff:169.254.169.254 is what a person types, and
  // new URL() normalises it to the hex form ::ffff:a9fe:a9fe, which is what
  // this function actually receives.
  const mappedDotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return classifyIpv4(mappedDotted[1]);

  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    const dotted = [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
    return classifyIpv4(dotted);
  }

  if (lower === "::" || lower === "::0") return "local"; // unspecified
  if (lower === "::1") return "local"; // loopback
  if (lower.startsWith("fe8") || lower.startsWith("fe9")) return "local"; // link-local
  if (lower.startsWith("fea") || lower.startsWith("feb")) return "local";
  if (lower.startsWith("fc") || lower.startsWith("fd")) return "local"; // unique-local
  if (lower.startsWith("ff")) return "local"; // multicast

  return "public";
}

export function classifyAddress(address: string): AddressClass {
  if (net.isIPv4(address)) return classifyIpv4(address);
  if (net.isIPv6(address)) return classifyIpv6(address);
  // Not an address at all. Nothing to judge — the caller's own resolution
  // step decides whether it goes anywhere.
  return "public";
}

export interface OutboundUrlOptions {
  /**
   * Whether destinations on the operator's own network are permitted.
   * Defaults to true, and to false only when the operator sets
   * BLOCK_PRIVATE_NETWORK_TARGETS=true.
   */
  allowLocal?: boolean;
}

function localAllowedByDefault(): boolean {
  return process.env.BLOCK_PRIVATE_NETWORK_TARGETS !== "true";
}

/**
 * Validates a destination URL. Returns the parsed URL.
 *
 * Rejects only non-HTTP(S) schemes and cloud instance-metadata addresses —
 * plus local destinations when the operator has opted into blocking them.
 * IP-literal hosts and local hostnames are supported destinations.
 */
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

  const allowLocal = options.allowLocal ?? localAllowedByDefault();
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  // An IP literal is judged directly and never looked up — a "hostname" that
  // is already an address must not get a second, different answer.
  const addresses = net.isIP(hostname) ? [hostname] : await resolveQuietly(hostname);

  for (const address of addresses) {
    const classification = classifyAddress(address);

    if (classification === "metadata") {
      throw new UnsafeOutboundUrlError(
        `${parsed.hostname} resolves to ${address}, a cloud instance-metadata address.`,
      );
    }

    if (classification === "local" && !allowLocal) {
      throw new UnsafeOutboundUrlError(
        `${parsed.hostname} resolves to ${address} on this machine's own network, and ` +
          "BLOCK_PRIVATE_NETWORK_TARGETS is set.",
      );
    }
  }

  return parsed;
}

/**
 * Resolves a hostname, returning an empty list if it can't be resolved.
 *
 * Not being resolvable is not a policy failure — see the note at the top of
 * this file. Callers treat an empty list as "nothing to check".
 */
async function resolveQuietly(hostname: string): Promise<string[]> {
  try {
    const entries = await dns.lookup(hostname, { all: true });
    return entries.map((entry) => entry.address);
  } catch {
    return [];
  }
}

export interface SafeFetchOptions extends OutboundUrlOptions {
  timeoutMs?: number;
  /**
   * Caps how much of the response body is read. A configured endpoint that
   * streams indefinitely would otherwise hold memory for as long as it likes.
   */
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * fetch() with the destination checked first, a hard timeout, and a bounded
 * response body. Returns the response plus the already-read body text, since
 * enforcing the size cap means consuming the stream here.
 */
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
