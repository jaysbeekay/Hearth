// In-process rate limiting for the endpoints worth brute-forcing (#155):
// login, TOTP codes, recovery codes, password reset and passkey challenges,
// plus the expensive OCR/AI paths.
//
// Deliberately dependency-free and in-memory. Hearth is a single-container,
// single-household deployment — there's no second instance for a shared
// counter to coordinate with, and requiring Redis to get basic throttling
// would be a poor trade for a self-hoster. The consequences are worth being
// explicit about: counters reset when the process restarts, and they aren't
// shared if someone does run multiple replicas behind a load balancer.
//
// Limits are keyed by identity *and* client address where both are known, so
// one attacker can't lock every account out by guessing against each in turn,
// and a shared NAT egress doesn't lock out a whole household.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Keeps the map from growing without bound on a long-running process. Cheap:
// it only runs when a key is touched, and only walks expired entries.
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitRule {
  /** Maximum attempts allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Attempts left in the current window. */
  remaining: number;
  /** Seconds until the window resets — for a Retry-After header or message. */
  retryAfterSeconds: number;
}

// Named rules rather than magic numbers at each call site, so the whole
// policy is visible in one place.
export const RATE_LIMITS = {
  // Password guessing. Deliberately strict: a household has a handful of
  // users, so a legitimate person hitting 10 failures in 15 minutes is
  // already unusual.
  login: { limit: 10, windowMs: 15 * 60_000 },
  // Six digits is a million possibilities, but a 30-second step and a
  // tolerance window make untethered guessing viable without a cap.
  totp: { limit: 8, windowMs: 10 * 60_000 },
  // Recovery codes are high-entropy but single-use and long-lived.
  recoveryCode: { limit: 5, windowMs: 60 * 60_000 },
  // Reset requests send mail; the cap is as much about not turning the app
  // into a mail relay as about enumeration.
  passwordReset: { limit: 5, windowMs: 60 * 60_000 },
  // Challenge issuance — each one writes a row.
  passkeyChallenge: { limit: 20, windowMs: 15 * 60_000 },
  // OCR and AI extraction spawn processes or bill a third-party key.
  documentExtraction: { limit: 30, windowMs: 5 * 60_000 },
  // Longer-horizon companion to documentExtraction — bounds total daily
  // spend/load even across many separate 5-minute windows, e.g. someone
  // scripting requests to stay just under the burst limit. 200 is generous
  // enough to cover migrating a household's whole paper trail in one sitting.
  documentExtractionDaily: { limit: 200, windowMs: 24 * 60 * 60_000 },
  // Chat turns bill the household's own API key.
  chat: { limit: 60, windowMs: 5 * 60_000 },
  // Daily companion to chat, same rationale as documentExtractionDaily.
  chatDaily: { limit: 500, windowMs: 24 * 60 * 60_000 },
  // Feedback creates a public GitHub issue, so keep accidental repeats and
  // issue spam bounded per signed-in household member.
  feedback: { limit: 5, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Reports whether a caller is currently over the limit, WITHOUT counting this
 * call. Pair it with recordFailedAttempt() on authentication paths, where only
 * failures should count — a successful sign-in redirects (throws), so counting
 * every attempt would leave the increment in place and eventually lock out
 * someone whose only crime was signing in on several devices.
 */
export function checkRateLimit(
  name: RateLimitName,
  identifier: string,
  now = Date.now(),
): RateLimitResult {
  const rule = RATE_LIMITS[name];
  const existing = buckets.get(`${name}:${identifier}`);

  if (!existing || existing.resetAt <= now) {
    return { allowed: true, remaining: rule.limit, retryAfterSeconds: 0 };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  return {
    allowed: existing.count < rule.limit,
    remaining: Math.max(0, rule.limit - existing.count),
    retryAfterSeconds,
  };
}

/** Counts one failure toward the limit. */
export function recordFailedAttempt(
  name: RateLimitName,
  identifier: string,
  now = Date.now(),
): void {
  consumeRateLimit(name, identifier, now);
}

/**
 * Records an attempt and reports whether it may proceed.
 *
 * Right model for cost-based limits (OCR, AI) where every call is expensive
 * whether or not it succeeds. For authentication use checkRateLimit() plus
 * recordFailedAttempt() instead.
 */
export function consumeRateLimit(
  name: RateLimitName,
  identifier: string,
  now = Date.now(),
): RateLimitResult {
  const rule = RATE_LIMITS[name];
  sweep(now);

  const key = `${name}:${identifier}`;
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, remaining: rule.limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  if (existing.count > rule.limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  return {
    allowed: true,
    remaining: rule.limit - existing.count,
    retryAfterSeconds,
  };
}

/**
 * Clears a counter — call after a successful authentication so a user who
 * mistyped a few times isn't still near the limit afterwards.
 */
export function resetRateLimit(name: RateLimitName, identifier: string): void {
  buckets.delete(`${name}:${identifier}`);
}

/**
 * Like consumeRateLimit, but checks and records several rules together for
 * the same identifier — a short burst window layered under a longer daily
 * ceiling — and reports the most restrictive result. Every rule is recorded
 * even when an earlier one already blocks, so a request that trips the
 * daily cap still counts toward the burst window too.
 */
export function consumeLayeredRateLimit(
  names: RateLimitName[],
  identifier: string,
  now = Date.now(),
): RateLimitResult {
  const results = names.map((name) => consumeRateLimit(name, identifier, now));
  const blocked = results.find((r) => !r.allowed);
  if (blocked) return blocked;
  return results.reduce((worst, r) => (r.remaining < worst.remaining ? r : worst));
}

/** Test seam. */
export function __clearAllRateLimits(): void {
  buckets.clear();
  lastSweep = 0;
}

/**
 * Best-effort client address from proxy headers. Only ever used as part of a
 * rate-limit key: it's attacker-controllable when Hearth isn't behind a proxy
 * that overwrites these, so it must never be used for authorization.
 */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}
