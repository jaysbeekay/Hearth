import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Flame } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isSmtpConfigured } from "@/lib/appSettings";
import { isGithubOAuthConfigured } from "@/lib/env";
import { LoginForm } from "@/components/LoginForm";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ passwordChanged?: string }>;
}) {
  const { passwordChanged } = await searchParams;
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    redirect("/setup");
  }

  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  const smtpConfigured = await isSmtpConfigured();

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Flame size={32} className="text-accent" />
          <h1 className="text-2xl font-semibold">Welcome back</h1>
          <p className="text-sm text-foreground/60">Sign in to your household hub.</p>
        </div>
        {passwordChanged && (
          <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-foreground/70">
            Password updated. Changing it signs out every device, so sign in again with your
            new password.
          </p>
        )}
        <div className="rounded-xl border border-border bg-surface p-6">
          <LoginForm smtpConfigured={smtpConfigured} githubConfigured={isGithubOAuthConfigured()} />
        </div>
      </div>
    </div>
  );
}
