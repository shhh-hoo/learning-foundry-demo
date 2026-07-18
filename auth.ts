import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { randomUUID } from "node:crypto";
import { compare } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { institutionMemberships, institutions, users } from "@/db/schema";

const credentialsSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8),
  institutionSlug: z.string().min(2),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/sign-in" },
  providers: [
    Credentials({
      name: "Learning Foundry account",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        institutionSlug: { label: "Institution", type: "text" },
      },
      authorize: async (raw) => {
        if (process.env.SYNTHETIC_SHOWCASE_MODE !== "true") return null;
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const [row] = await getDb().select({ user: users, institution: institutions })
          .from(users)
          .innerJoin(institutionMemberships, eq(institutionMemberships.userId, users.id))
          .innerJoin(institutions, eq(institutions.id, institutionMemberships.institutionId))
          .where(and(eq(users.email, parsed.data.email), eq(institutions.slug, parsed.data.institutionSlug)))
          .limit(1);
        if (!row?.user.active || !row.user.passwordHash || !(await compare(parsed.data.password, row.user.passwordHash))) return null;
        return { id: row.user.id, email: row.user.email, name: row.user.name, activeInstitutionId: row.institution.id, authMethod: "synthetic-credentials" };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) {
        const activeUser = user as typeof user & { activeInstitutionId: string; authMethod: string };
        token.userId = user.id;
        token.activeInstitutionId = activeUser.activeInstitutionId;
        token.authMethod = activeUser.authMethod;
        token.sessionId = randomUUID();
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        const activeSessionUser = session.user as typeof session.user & { activeInstitutionId: string; authMethod: string; sessionId: string };
        activeSessionUser.id = String(token.userId ?? token.sub);
        activeSessionUser.activeInstitutionId = String(token.activeInstitutionId ?? "");
        activeSessionUser.authMethod = String(token.authMethod ?? "unknown");
        activeSessionUser.sessionId = String(token.sessionId ?? token.jti ?? "");
      }
      return session;
    },
    authorized({ auth: session, request }) {
      const pathname = request.nextUrl.pathname;
      if (pathname.startsWith("/api/health") || pathname.startsWith("/api/auth") || pathname === "/sign-in") return true;
      return Boolean(session?.user?.id);
    },
  },
});
