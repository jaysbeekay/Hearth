import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/types";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function POST() {
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
