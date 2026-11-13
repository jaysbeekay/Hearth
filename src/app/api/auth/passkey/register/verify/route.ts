import { NextResponse } from "next/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyPasskeyRegistration } from "@/lib/passkeyAuth";

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

  const result = await verifyPasskeyRegistration(session.user.id, body.response);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { stored } = result;

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
