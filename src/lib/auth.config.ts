import type { NextAuthConfig } from "next-auth";
import type { Role } from "@/generated/prisma/enums";

declare module "next-auth" {
  interface User {
    role?: Role;
  }
  interface Session {
    user: {
      id: string;
      role: Role;
      name?: string | null;
      email?: string | null;
    };
  }
}

// `next-auth/jwt`'s package exports map isn't resolvable by TS's ambient
// `declare module` augmentation lookup, so the JWT token is narrowed with a
// local type instead of global augmentation.
type AppJwt = { role?: Role; sub?: string };

const PUBLIC_PATHS = [
  "/login",
  "/setup",
  "/forgot-password",
  "/reset-password",
  "/accept-invitation",
  "/api/cron",
  "/api/mcp",
];

// Shared by the `authorized` callback below and by src/proxy.ts, which has to
// make the same allow/deny decision itself — NextAuth skips its own redirect
// once a handler is supplied, and the proxy supplies one so it can attach
// security headers. One list, two callers.
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname.startsWith(path));
}

export const authConfig: NextAuthConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized: ({ auth: session, request }) => {
      if (isPublicPath(request.nextUrl.pathname)) return true;
      return Boolean(session?.user);
    },
    jwt: ({ token, user }) => {
      const appToken = token as typeof token & AppJwt;
      if (user) appToken.role = user.role;
      return appToken;
    },
    session: ({ session, token }) => {
      const appToken = token as typeof token & AppJwt;
      if (appToken.sub) session.user.id = appToken.sub;
      if (appToken.role) session.user.role = appToken.role;
      return session;
    },
  },
};
