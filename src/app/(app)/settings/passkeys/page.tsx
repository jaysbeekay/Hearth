import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PasskeyItem } from "@/components/PasskeyItem";
import { PasskeyRegisterButton } from "@/components/PasskeyRegisterButton";
import { BackLink } from "@/components/BackLink";
import { SETTINGS_ROUTES, settingsBackLink } from "@/lib/routeLabels";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = { title: SETTINGS_ROUTES.passkeys.label };

export default async function PasskeysPage() {
  const session = await auth();
  // auth() can now return null mid-render — a session is revoked as soon as
  // the account's sessionVersion moves (password/role change) or the account
  // is deleted, which the proxy won't have caught for an in-flight request.
  if (!session?.user) redirect("/login");

  const passkeys = await prisma.passkeyCredential.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="max-w-2xl space-y-6">
      <BackLink {...settingsBackLink(SETTINGS_ROUTES.passkeys)} />
      <div>
        <h1 className="text-2xl font-medium">{SETTINGS_ROUTES.passkeys.label}</h1>
        <p className="mt-1 text-sm text-muted">
          Sign in with Face ID, Touch ID, or a hardware security key instead of your password.
          Passkeys are per-device — register one on each device you want to use. Your password
          remains as a fallback.
        </p>
      </div>

      <Card as="section">
        <h2 className="mb-3 font-medium">Your passkeys</h2>
        {passkeys.length === 0 ? (
          <p className="text-sm text-muted">No passkeys registered yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {passkeys.map((pk) => (
              <PasskeyItem
                key={pk.id}
                credentialId={pk.credentialId}
                nickname={pk.nickname}
                createdAt={pk.createdAt}
                lastUsedAt={pk.lastUsedAt}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card as="section">
        <h2 className="mb-3 font-medium">Register a new passkey</h2>
        <p className="mb-4 text-sm text-muted">
          Give it an optional nickname so you can identify it later (e.g. &quot;iPhone 16 Face ID&quot;).
        </p>
        <PasskeyRegisterButton />
      </Card>
    </div>
  );
}
