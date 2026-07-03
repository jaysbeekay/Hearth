import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/types";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    include: { passkeys: { select: { credentialId: true, transports: true } } },
  });

  const rpId = new URL(env.appUrl).hostname;

  const options = await generateRegistrationOptions({
    rpName: "Hearth",
    rpID: rpId,
    userID: user.id,
    userName: user.email,
    userDisplayName: user.name,
    attestationType: "none",
    excludeCredentials: user.passkeys.map((pk) => ({
      id: Buffer.from(pk.credentialId, "base64url"),
      type: "public-key" as const,
      transports: pk.transports
        ? (JSON.parse(pk.transports) as AuthenticatorTransportFuture[])
        : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  await prisma.passkeyChallenge.upsert({
    where: { challenge: options.challenge },
    create: {
      userId: user.id,
      challenge: options.challenge,
      type: "registration",
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
    update: {},
  });

  return NextResponse.json(options);
}
