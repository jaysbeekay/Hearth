import type { Metadata } from "next";
import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/crypto";
import { AcceptInvitationForm } from "@/components/AcceptInvitationForm";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Accept invitation" };
export const dynamic = "force-dynamic";

function isTokenValid(
  inviteToken: { purpose: string; usedAt: Date | null; expiresAt: Date } | null,
) {
  return Boolean(
    inviteToken &&
      inviteToken.purpose === "INVITE" &&
      !inviteToken.usedAt &&
      inviteToken.expiresAt.getTime() > Date.now(),
  );
}

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const inviteToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  const valid = isTokenValid(inviteToken);

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-medium">Welcome to Hearth</h1>
          {!valid && (
            <p className="text-sm text-muted">
              This invitation link is invalid or has expired. Ask an admin to invite you again.
            </p>
          )}
        </div>

        {valid ? (
          <Card>
            <AcceptInvitationForm token={token} />
          </Card>
        ) : (
          <p className="text-center text-sm text-muted">
            <Link href="/login" className="text-accent hover:underline">
              Back to sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
