import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isEncryptionConfigured } from "@/lib/env";
import { encryptSecret } from "@/lib/crypto";
import { verifyTotpCode, generateRecoveryCodes, hashRecoveryCodes } from "@/lib/totp";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isEncryptionConfigured()) {
    return NextResponse.json({ error: "Encryption is not configured." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const secret = body?.secret;
  const code = body?.code;
  if (typeof secret !== "string" || typeof code !== "string") {
    return NextResponse.json({ error: "Missing secret or code." }, { status: 400 });
  }

  if (!verifyTotpCode(secret, code)) {
    return NextResponse.json({ error: "Invalid code. Check your authenticator app and try again." }, { status: 400 });
  }

  const recoveryCodes = generateRecoveryCodes();
  const hashedCodesJson = await hashRecoveryCodes(recoveryCodes);

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      totpSecret: encryptSecret(secret),
      totpEnabled: true,
      totpRecoveryCodes: encryptSecret(hashedCodesJson),
    },
  });

  return NextResponse.json({ recoveryCodes });
}
