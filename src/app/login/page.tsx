import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Flame } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isSmtpConfigured } from "@/lib/appSettings";
import { isDemoMode } from "@/lib/env";
import { LoginForm } from "@/components/LoginForm";
import { DemoBanner } from "@/components/DemoBanner";
import { demoLogin } from "@/lib/actions/demo";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    redirect("/setup");
  }

  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  const smtpConfigured = await isSmtpConfigured();
  const demo = isDemoMode();

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Flame size={32} className="text-accent" />
          <h1 className="text-2xl font-semibold">Welcome back</h1>
          <p className="text-sm text-foreground/60">Sign in to your household hub.</p>
        </div>

        {demo && <DemoBanner />}

        {demo ? (
          <div className="space-y-4 rounded-xl border border-border bg-surface p-6">
            <form action={demoLogin}>
              <SubmitButton className="w-full" pendingText="Loading demo…">
                Continue to demo
              </SubmitButton>
            </form>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface p-6">
            <LoginForm smtpConfigured={smtpConfigured} isDemo={demo} />
          </div>
        )}
      </div>
    </div>
  );
}
