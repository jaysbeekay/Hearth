import { z } from "zod";

// base64url, as PushSubscription.toJSON() gives the keys.
const base64url = z.string().regex(/^[A-Za-z0-9_-]+=*$/, "Invalid key.");

/** #375 — a browser's PushSubscription.toJSON(), plus a label for the device. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  keys: z.object({ p256dh: base64url.min(16).max(256), auth: base64url.min(8).max(64) }),
  deviceLabel: z.string().trim().max(100).optional(),
});

export const pushEndpointSchema = z.object({ endpoint: z.string().min(1).max(2048) });

export const pushDeviceIdSchema = z.object({ id: z.string().min(1).max(64) });
