import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/crypto";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";
import { inlineLinkClass } from "@/lib/ui";

export const metadata: Metadata = { title: "Reset password" };
export const dynamic = "force-dynamic";

function isTokenValid(resetToken: { usedAt: Date | null; expiresAt: Date } | null) {
  return Boolean(resetToken && !resetToken.usedAt && resetToken.expiresAt.getTime() > Date.now());
}

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  const valid = isTokenValid(resetToken);

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-8">
      <PageShell width="auth">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-medium">Choose a new password</h1>
          {!valid && (
            <p className="text-sm text-muted">
              This reset link is invalid or has expired. Request a new one below.
            </p>
          )}
        </div>

        {valid ? (
          <Card>
            <ResetPasswordForm token={token} />
          </Card>
        ) : (
          <p className="text-center text-sm text-muted">
            <Link href="/forgot-password" className={inlineLinkClass}>
              Request a new reset link
            </Link>
          </p>
        )}
      </PageShell>
    </div>
  );
}
