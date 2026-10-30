import { NextResponse } from "next/server";
import {
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { toStoredPasskey } from "@/lib/passkeyCredential";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { response: RegistrationResponseJSON; nickname?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rpId = new URL(env.appUrl).hostname;

  const storedChallenge = await prisma.passkeyChallenge.findFirst({
    where: {
      userId: session.user.id,
      type: "registration",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!storedChallenge) {
    return NextResponse.json({ error: "Challenge not found or expired." }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: storedChallenge.challenge,
      expectedOrigin: env.appUrl,
      expectedRPID: rpId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  await prisma.passkeyChallenge.delete({ where: { id: storedChallenge.id } });

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "Verification failed." }, { status: 400 });
  }

  const stored = toStoredPasskey(
    verification.registrationInfo.credential,
    body.response.response.transports,
  );

  const existing = await prisma.passkeyCredential.findUnique({
    where: { credentialId: stored.credentialId },
  });
  if (existing) {
    return NextResponse.json({ error: "Credential already registered." }, { status: 409 });
  }

  await prisma.passkeyCredential.create({
    data: {
      userId: session.user.id,
      ...stored,
      nickname: body.nickname?.trim() || null,
    },
  });

  return NextResponse.json({ verified: true });
}
