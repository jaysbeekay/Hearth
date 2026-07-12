import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PasskeyItem } from "@/components/PasskeyItem";
import { PasskeyRegisterButton } from "@/components/PasskeyRegisterButton";
import { getUserPreferences } from "@/lib/userPreferences";

export const metadata: Metadata = { title: "Passkeys" };

export default async function PasskeysPage() {
  const session = await auth();
  const [passkeys, { dateFormat }] = await Promise.all([
    prisma.passkeyCredential.findMany({
      where: { userId: session!.user.id },
      orderBy: { createdAt: "asc" },
    }),
    getUserPreferences(),
  ]);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Passkeys</h1>
        <p className="mt-1 text-sm text-foreground/60">
          Sign in with Face ID, Touch ID, or a hardware security key instead of your password.
          Passkeys are per-device — register one on each device you want to use. Your password
          remains as a fallback.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Your passkeys</h2>
        {passkeys.length === 0 ? (
          <p className="text-sm text-foreground/60">No passkeys registered yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {passkeys.map((pk) => (
              <PasskeyItem
                key={pk.id}
                credentialId={pk.credentialId}
                nickname={pk.nickname}
                createdAt={pk.createdAt}
                lastUsedAt={pk.lastUsedAt}
                dateFormat={dateFormat}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 md:p-6">
        <h2 className="mb-3 font-medium">Register a new passkey</h2>
        <p className="mb-4 text-sm text-foreground/60">
          Give it an optional nickname so you can identify it later (e.g. &quot;iPhone 16 Face ID&quot;).
        </p>
        <PasskeyRegisterButton />
      </section>
    </div>
  );
}
