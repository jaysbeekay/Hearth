import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";

export const metadata: Metadata = { title: "Reset password" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const resetToken = await prisma.passwordResetToken.findUnique({ where: { token } });
  const valid = Boolean(resetToken && !resetToken.usedAt && resetToken.expiresAt.getTime() > Date.now());

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <KeyRound size={32} className="text-accent" />
          <h1 className="text-2xl font-semibold">Choose a new password</h1>
          {!valid && (
            <p className="text-sm text-foreground/60">
              This reset link is invalid or has expired. Request a new one below.
            </p>
          )}
        </div>

        {valid ? (
          <div className="rounded-xl border border-border bg-surface p-6">
            <ResetPasswordForm token={token} />
          </div>
        ) : (
          <p className="text-center text-sm text-foreground/60">
            <Link href="/forgot-password" className="text-accent hover:underline">
              Request a new reset link
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
