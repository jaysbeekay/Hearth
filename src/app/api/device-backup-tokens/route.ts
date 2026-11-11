// SPIKE #493 — NOT FOR MERGE. Issues a per-device backup token to a signed-in,
// non-READONLY household member (production would put this in Settings, with
// a list and Revoke; the prototype only needs to mint one). The raw token is
// returned once and only its SHA-256 is stored.
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateToken, hashToken } from "@/lib/crypto";

const bodySchema = z.object({ name: z.string().trim().min(1).max(80) });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (session.user.role === "READONLY") return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the device a name" }, { status: 400 });
  const token = generateToken();
  const row = await prisma.deviceBackupToken.create({
    data: { name: parsed.data.name, tokenHash: hashToken(token), createdById: session.user.id },
  });
  return NextResponse.json({ id: row.id, name: row.name, token }, { headers: { "cache-control": "no-store" } });
}

// Revoke: the device's uploads stop at once; its stored backups stay until
// pruned or deleted (production: offer "revoke and delete backups").
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (session.user.role === "READONLY") return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const { count } = await prisma.deviceBackupToken.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  return NextResponse.json({ revoked: count === 1 });
}
