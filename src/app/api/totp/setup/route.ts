import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isEncryptionConfigured } from "@/lib/env";
import { generateTotpSecret, buildTotpUri } from "@/lib/totp";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isEncryptionConfigured()) {
    return NextResponse.json({ error: "Encryption is not configured." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }
  if (user.totpEnabled) {
    return NextResponse.json(
      { error: "Two-factor authentication is already enabled." },
      { status: 400 },
    );
  }

  const secret = generateTotpSecret();
  const uri = buildTotpUri(secret, user.email);
  const qrDataUri = await QRCode.toDataURL(uri);

  return NextResponse.json({ secret, qrDataUri });
}
