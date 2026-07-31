import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/types";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { clientAddress, consumeRateLimit } from "@/lib/rateLimit";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function POST() {
  // Each challenge writes a row; unauthenticated issuance is the one that
  // needs a bound, so key it by client address.
  const { headers } = await import("next/headers");
  const challengeThrottle = consumeRateLimit(
    "passkeyChallenge",
    clientAddress(await headers()),
  );
  if (!challengeThrottle.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(challengeThrottle.retryAfterSeconds) } },
    );
  }

  const rpId = new URL(env.appUrl).hostname;

  const options = await generateAuthenticationOptions({
    rpID: rpId,
    userVerification: "preferred",
    // no allowCredentials — discoverable credential / passkey flow
  });

  await prisma.passkeyChallenge.create({
    data: {
      userId: null,
      challenge: options.challenge,
      type: "authentication",
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });

  return NextResponse.json(options);
}
