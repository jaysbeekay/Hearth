import { z } from "zod";

// base64url, as PushSubscription.toJSON() gives the keys, optionally padded.
const base64url = z.string().regex(/^[A-Za-z0-9_-]+=*$/, "Invalid key.");

const ENDPOINT_MAX = 2048;

/**
 * #375 — a browser's PushSubscription.toJSON(), plus a label for the device.
 * The keys are fixed-size: p256dh is a 65-byte P-256 point (87 characters,
 * 88 padded) and auth a 16-byte secret (22, or 24 padded), so a wrong length
 * is refused here instead of failing on every send.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(ENDPOINT_MAX),
  keys: z.object({ p256dh: base64url.min(87).max(88), auth: base64url.min(22).max(24) }),
  deviceLabel: z.string().trim().max(100).optional(),
  /** The subscription this browser just replaced, if any. */
  previousEndpoint: z.string().min(1).max(ENDPOINT_MAX).optional(),
});

export const pushEndpointSchema = z.object({ endpoint: z.string().min(1).max(ENDPOINT_MAX) });
