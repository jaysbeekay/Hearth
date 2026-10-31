import type { Metadata } from "next";
import Link from "next/link";
import { isSmtpConfigured } from "@/lib/appSettings";
import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";
import { inlineLinkClass } from "@/lib/ui";

export const metadata: Metadata = { title: "Reset password" };
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const smtpConfigured = await isSmtpConfigured();

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-8">
      <PageShell width="auth">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-medium">Reset your password</h1>
          <p className="text-sm text-muted">
            {smtpConfigured
              ? "Enter your email and we'll send you a link to reset your password."
              : "Password reset emails aren't set up for this household yet. Contact your administrator for help signing in."}
          </p>
        </div>

        {smtpConfigured && (
          <Card>
            <ForgotPasswordForm />
          </Card>
        )}

        <p className="text-center text-sm text-muted">
          <Link href="/login" className={inlineLinkClass}>
            Back to sign in
          </Link>
        </p>
      </PageShell>
    </div>
  );
}
