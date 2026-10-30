import { cache } from "react";
import NextAuth, { CredentialsSignin, type Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { env, isGithubOAuthConfigured } from "@/lib/env";
import { authConfig } from "@/lib/auth.config";
import type { Role } from "@/generated/prisma/enums";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { verifyTotpCode, consumeRecoveryCode } from "@/lib/totp";
import { authorizePasskey } from "@/lib/passkeyAuth";

export class TotpRequiredSignin extends CredentialsSignin {
  code = "totp_required";
}

export class InvalidTotpSignin extends CredentialsSignin {
  code = "invalid_totp";
}

const nextAuth = NextAuth({
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
      authorize: (credentials) => authorizePasskey(credentials),
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

export const { handlers, signIn, signOut } = nextAuth;

/**
 * The signed-in session, or null. Memoised per server render with React's
 * cache(), so the (app) layout and the page it wraps share one lookup (and
 * one jwt-callback database read) per request instead of one each (#400).
 * Outside a render (server actions, route handlers) cache() doesn't
 * memoise, so each call still sees the current cookie. Only the no-argument
 * form is exported: src/proxy.ts builds its own middleware auth from
 * auth.config.ts.
 */
export const auth = cache(async (): Promise<Session | null> => nextAuth.auth());
