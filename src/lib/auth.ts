import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/types";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { authConfig } from "@/lib/auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase().trim() },
        });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

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
  ],
});
