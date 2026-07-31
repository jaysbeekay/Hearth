import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { isEncryptionConfigured } from "@/lib/env";

// Webhook secrets sign outbound HMAC payloads, so they're bearer credentials
// for anything consuming those webhooks — they were previously stored in the
// clear (#164).
//
// Rows carry a `secretEncrypted` flag rather than being migrated in one shot,
// because an instance running without ENCRYPTION_KEY has no way to encrypt
// them. Those rows keep working as plaintext and are upgraded the next time
// the secret is written, or by the startup backfill in instrumentation.ts once
// a key is configured.

export function encodeWebhookSecret(secret: string | null): {
  secret: string | null;
  secretEncrypted: boolean;
} {
  if (!secret) return { secret: null, secretEncrypted: false };
  if (!isEncryptionConfigured()) return { secret, secretEncrypted: false };
  return { secret: encryptSecret(secret), secretEncrypted: true };
}

export function decodeWebhookSecret(endpoint: {
  secret: string | null;
  secretEncrypted: boolean;
}): string | null {
  if (!endpoint.secret) return null;
  if (!endpoint.secretEncrypted) return endpoint.secret;
  try {
    return decryptSecret(endpoint.secret);
  } catch {
    // Wrong or rotated ENCRYPTION_KEY. Signing with a corrupt secret would
    // produce silently-invalid signatures, so send none and let the receiver
    // reject an unsigned delivery.
    return null;
  }
}

// One-time upgrade of rows written before ENCRYPTION_KEY existed. Cheap and
// idempotent: after the first run there's nothing left matching the filter.
export async function backfillWebhookSecrets(): Promise<void> {
  if (!isEncryptionConfigured()) return;
  const { prisma } = await import("@/lib/prisma");

  const plaintext = await prisma.webhookEndpoint.findMany({
    where: { secretEncrypted: false, secret: { not: null } },
    select: { id: true, secret: true },
  });

  for (const row of plaintext) {
    if (!row.secret) continue;
    await prisma.webhookEndpoint.update({
      where: { id: row.id },
      data: encodeWebhookSecret(row.secret),
    });
  }

  if (plaintext.length > 0) {
    console.log(`[security] encrypted ${plaintext.length} webhook secret(s) at rest`);
  }
}
