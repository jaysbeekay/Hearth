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
  "/api/cron",
  "/api/mcp",
];

export const authConfig: NextAuthConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized: ({ auth: session, request }) => {
      const isPublic = PUBLIC_PATHS.some((path) =>
        request.nextUrl.pathname.startsWith(path),
      );
      if (isPublic) return true;
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
