import { createHash, timingSafeEqual } from "crypto";

// Hashing first gives both sides the same length, which timingSafeEqual
// requires, without leaking the configured secret's length.
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time check of an `x-cron-secret` header against CRON_SECRET. */
export function cronSecretMatches(provided: string | null, secret: string): boolean {
  return timingSafeEqual(digest(provided ?? ""), digest(secret));
}
