import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { isSmtpConfigured } from "@/lib/appSettings";
import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset password" };
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const smtpConfigured = await isSmtpConfigured();

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <KeyRound size={32} className="text-accent" />
          <h1 className="text-2xl font-semibold">Reset your password</h1>
          <p className="text-sm text-foreground/60">
            {smtpConfigured
              ? "Enter your email and we'll send you a link to reset your password."
              : "Password reset emails aren't set up for this household yet. Contact your administrator for help signing in."}
          </p>
        </div>

        {smtpConfigured && (
          <div className="rounded-xl border border-border bg-surface p-6">
            <ForgotPasswordForm />
          </div>
        )}

        <p className="text-center text-sm text-foreground/60">
          <Link href="/login" className="text-accent hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
