import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Flame } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isSmtpConfigured } from "@/lib/appSettings";
import { isAppUrlConfigured, isGithubOAuthConfigured } from "@/lib/env";
import { LoginForm } from "@/components/LoginForm";
import { SignedOutCacheCleanup } from "@/components/SignedOutCacheCleanup";
import { safeCallbackPath } from "@/lib/callbackUrl";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ passwordChanged?: string; callbackUrl?: string }>;
}) {
  const { passwordChanged, callbackUrl } = await searchParams;
  const requestHeaders = await headers();
  // #341 — where to send the user once they're signed in: the page they were
  // bounced from by src/proxy.ts, reduced to a same-origin path.
  const destination = safeCallbackPath(
    callbackUrl,
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    redirect("/setup");
  }

  const session = await auth();
  if (session?.user) {
    redirect(destination);
  }

  // #344 — only offer passkey sign-in when it can actually work: passkeys
  // need APP_URL (the WebAuthn relying-party ID) and at least one registered
  // credential. Otherwise the button opens a browser prompt that can only
  // fail with a confusing error.
  const [smtpConfigured, passkeyCount] = await Promise.all([
    isSmtpConfigured(),
    isAppUrlConfigured() ? prisma.passkeyCredential.count() : Promise.resolve(0),
  ]);

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Flame size={32} className="text-accent" />
          <h1 className="text-2xl font-semibold">Welcome back</h1>
          <p className="text-sm text-muted">Sign in to Hearth.</p>
        </div>
        {passwordChanged && (
          <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
            Password updated. Changing it signs out every device, so sign in again with your
            new password.
          </p>
        )}
        <SignedOutCacheCleanup />
        <div className="rounded-xl border border-border bg-surface p-6">
          <LoginForm
            smtpConfigured={smtpConfigured}
            githubConfigured={isGithubOAuthConfigured()}
            passkeysAvailable={passkeyCount > 0}
            callbackUrl={destination}
          />
        </div>
      </div>
    </div>
  );
}
