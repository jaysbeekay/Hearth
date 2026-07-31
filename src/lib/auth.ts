import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import bcrypt from "bcryptjs";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/types";
import { prisma } from "@/lib/prisma";
import { env, isGithubOAuthConfigured } from "@/lib/env";
import { authConfig } from "@/lib/auth.config";
import type { Role } from "@/generated/prisma/enums";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { verifyTotpCode, consumeRecoveryCode } from "@/lib/totp";

export class TotpRequiredSignin extends CredentialsSignin {
  code = "totp_required";
}

export class InvalidTotpSignin extends CredentialsSignin {
  code = "invalid_totp";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email" },
        password: { label: "Password", type: "password" },
        totpCode: { label: "Two-factor code" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        const totpCode = credentials?.totpCode;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase().trim() },
        });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        if (user.totpEnabled) {
          const code = typeof totpCode === "string" ? totpCode.trim() : "";
          if (!code) throw new TotpRequiredSignin();

          const secret = user.totpSecret ? decryptSecret(user.totpSecret) : null;
          let verified = secret ? verifyTotpCode(secret, code) : false;

          if (!verified && user.totpRecoveryCodes) {
            const hashesJson = decryptSecret(user.totpRecoveryCodes);
            const remaining = await consumeRecoveryCode(code, hashesJson);
            if (remaining !== null) {
              verified = true;
              await prisma.user.update({
                where: { id: user.id },
                data: { totpRecoveryCodes: encryptSecret(remaining) },
              });
            }
          }

          if (!verified) throw new InvalidTotpSignin();
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),

    Credentials({
      id: "passkey",
      credentials: {
        credentialId: {},
        assertionJSON: {},
        challenge: {},
      },
      authorize: async (credentials) => {
        if (
          typeof credentials?.credentialId !== "string" ||
          typeof credentials?.assertionJSON !== "string" ||
          typeof credentials?.challenge !== "string"
        ) {
          return null;
        }

        const storedChallenge = await prisma.passkeyChallenge.findUnique({
          where: { challenge: credentials.challenge },
        });
        if (
          !storedChallenge ||
          storedChallenge.type !== "authentication" ||
          storedChallenge.expiresAt < new Date()
        ) {
          return null;
        }

        const passkeyCredential = await prisma.passkeyCredential.findUnique({
          where: { credentialId: credentials.credentialId },
          include: { user: true },
        });
        if (!passkeyCredential) return null;

        let assertion: AuthenticationResponseJSON;
        try {
          assertion = JSON.parse(credentials.assertionJSON);
        } catch {
          return null;
        }

        const rpId = new URL(env.appUrl).hostname;

        let verification;
        try {
          verification = await verifyAuthenticationResponse({
            response: assertion,
            expectedChallenge: storedChallenge.challenge,
            expectedOrigin: env.appUrl,
            expectedRPID: rpId,
            authenticator: {
              credentialID: Buffer.from(passkeyCredential.credentialId, "base64url"),
              credentialPublicKey: new Uint8Array(passkeyCredential.publicKey),
              counter: passkeyCredential.counter,
              transports: passkeyCredential.transports
                ? (JSON.parse(
                    passkeyCredential.transports,
                  ) as AuthenticatorTransportFuture[])
                : undefined,
            },
          });
        } catch {
          return null;
        }

        if (!verification.verified) return null;

        await Promise.all([
          prisma.passkeyCredential.update({
            where: { id: passkeyCredential.id },
            data: {
              counter: verification.authenticationInfo.newCounter,
              lastUsedAt: new Date(),
            },
          }),
          prisma.passkeyChallenge.delete({ where: { id: storedChallenge.id } }),
        ]);

        return {
          id: passkeyCredential.user.id,
          name: passkeyCredential.user.name,
          email: passkeyCredential.user.email,
          role: passkeyCredential.user.role,
        };
      },
    }),

    ...(isGithubOAuthConfigured()
      ? [GitHub({ clientId: env.github.clientId, clientSecret: env.github.clientSecret })]
      : []),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Revalidates the session against the database on every read (#168).
    //
    // authConfig's own jwt callback only stamps the role at sign-in, so a JWT
    // kept saying ADMIN after a demotion, and stayed valid after the account
    // was deleted, for the token's whole lifetime. This override lives in
    // auth.ts rather than auth.config.ts because auth.config.ts is also loaded
    // by src/proxy.ts on the edge runtime, where Prisma can't run. That split
    // is safe: the proxy only answers "is there a session at all", while every
    // page and server action calls auth() from here, which is what actually
    // gates data.
    jwt: async ({ token, user }) => {
      const appToken = token as typeof token & { role?: Role; sub?: string; sv?: number };

      if (user) {
        appToken.role = user.role;
        const fresh = await prisma.user.findUnique({
          where: { id: user.id },
          select: { sessionVersion: true },
        });
        appToken.sv = fresh?.sessionVersion ?? 0;
        return appToken;
      }

      if (!appToken.sub) return null;

      const current = await prisma.user.findUnique({
        where: { id: appToken.sub },
        select: { role: true, sessionVersion: true },
      });

      // Account deleted, or the session was explicitly invalidated by a
      // password or role change. Returning null drops the session.
      if (!current || current.sessionVersion !== (appToken.sv ?? 0)) return null;

      // Pick up role changes that didn't warrant invalidation.
      appToken.role = current.role;
      return appToken;
    },
    // Sign-up is invite-only (every User row is admin-created with a
    // password/placeholder hash already set) — an OAuth sign-in must match
    // an existing user's verified email rather than auto-creating one.
    signIn: async ({ user, account }) => {
      if (!account || account.provider === "credentials" || account.provider === "passkey") {
        return true;
      }

      const email = user.email;
      if (!email) return false;

      const existing = await prisma.user.findUnique({
        where: { email: email.toLowerCase().trim() },
      });
      if (!existing) return false;

      user.id = existing.id;
      user.role = existing.role;
      return true;
    },
  },
});
