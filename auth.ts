import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { assertProtectedAuthConfigured, isPublicPath, resolveOidcContract, syntheticCredentialsAllowed } from "@/application/auth-contract";
import {
  authenticateOidcSubject,
  authenticateSyntheticPrincipal,
  issueAuthSession,
  recordSecurityEventBestEffort,
  redactedPrincipal,
  revokeAuthSession,
  verifyAndRotateAuthSession,
} from "@/application/auth-session";
import { getAuthDb } from "@/db/client";
import { institutionMemberships, institutions, users } from "@/db/schema";

const credentialsSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8),
  institutionSlug: z.string().min(2),
});

type FoundryAuthUser = {
  id: string;
  foundryUserId: string;
  name: string;
  email: string;
  activeInstitutionId: string;
  authMethod: "oidc" | "synthetic-credentials";
  authIssuer: string;
  authSubject: string;
  identityId: string;
};

const oidc = resolveOidcContract();
const providers: NextAuthConfig["providers"] = [];

if (oidc) {
  providers.push({
    id: "oidc",
    name: "Institution identity provider",
    type: "oidc",
    issuer: oidc.issuer,
    clientId: oidc.clientId,
    clientSecret: oidc.clientSecret,
    checks: ["pkce", "state", "nonce"],
    authorization: { params: { scope: "openid profile email" } },
    async profile(profile: Record<string, unknown>) {
      const subject = z.string().min(1).parse(profile.sub);
      const trustedInstitution = profile[oidc.institutionClaim] == null ? null : z.string().min(1).parse(profile[oidc.institutionClaim]);
      const principal = await authenticateOidcSubject({ issuer: oidc.issuer, subject, trustedInstitution });
      return {
        id: principal.userId,
        foundryUserId: principal.userId,
        name: principal.name,
        email: principal.email,
        activeInstitutionId: principal.activeInstitutionId,
        authMethod: principal.authMethod,
        authIssuer: principal.issuer,
        authSubject: principal.subject,
        identityId: principal.identityId,
      } satisfies FoundryAuthUser;
    },
  });
}

if (syntheticCredentialsAllowed()) {
  providers.push(Credentials({
    name: "Isolated synthetic showcase",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
      institutionSlug: { label: "Institution", type: "text" },
    },
    authorize: async (raw) => {
      if (!syntheticCredentialsAllowed()) return null;
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return null;
      const [row] = await getAuthDb().select({ user: users, institution: institutions })
        .from(users)
        .innerJoin(institutionMemberships, eq(institutionMemberships.userId, users.id))
        .innerJoin(institutions, eq(institutions.id, institutionMemberships.institutionId))
        .where(and(eq(users.email, parsed.data.email), eq(institutions.slug, parsed.data.institutionSlug)))
        .limit(1);
      if (!row?.user.active || !row.user.passwordHash || !(await compare(parsed.data.password, row.user.passwordHash))) return null;
      const principal = await authenticateSyntheticPrincipal({ userId: row.user.id, activeInstitutionId: row.institution.id });
      return {
        id: principal.userId,
        foundryUserId: principal.userId,
        name: principal.name,
        email: principal.email,
        activeInstitutionId: principal.activeInstitutionId,
        authMethod: principal.authMethod,
        authIssuer: principal.issuer,
        authSubject: principal.subject,
        identityId: principal.identityId,
      } satisfies FoundryAuthUser;
    },
  }));
}

export const authConfig: NextAuthConfig = {
  trustHost: process.env.NODE_ENV !== "production" || process.env.AUTH_TRUST_HOST === "true",
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/sign-in" },
  providers,
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        const principal = user as typeof user & FoundryAuthUser;
        const issued = await issueAuthSession({
          userId: principal.foundryUserId,
          identityId: principal.identityId,
          issuer: principal.authIssuer,
          subject: principal.authSubject,
          name: principal.name,
          email: principal.email,
          activeInstitutionId: principal.activeInstitutionId,
          authMethod: principal.authMethod,
        });
        token.userId = principal.foundryUserId;
        token.activeInstitutionId = issued.activeInstitutionId;
        token.authMethod = principal.authMethod;
        token.authIssuer = issued.issuer;
        token.authSubject = issued.subject;
        token.sessionId = issued.sessionId;
        token.sessionVersion = issued.sessionVersion;
        token.authValid = true;
        return token;
      }
      if (!token.userId || !token.activeInstitutionId || !token.authIssuer || !token.authSubject || !token.sessionId || !token.sessionVersion) {
        token.authValid = false;
        return token;
      }
      try {
        const verified = await verifyAndRotateAuthSession({
          sessionId: String(token.sessionId),
          sessionVersion: Number(token.sessionVersion),
          userId: String(token.userId),
          issuer: String(token.authIssuer),
          subject: String(token.authSubject),
          activeInstitutionId: String(token.activeInstitutionId),
        });
        token.sessionVersion = verified.sessionVersion;
        token.authValid = true;
      } catch (error) {
        token.authValid = false;
        await recordSecurityEventBestEffort({
          eventClass: "AUTHENTICATION",
          eventCode: "SESSION_REAUTH_REQUIRED",
          principal: redactedPrincipal(String(token.authIssuer), String(token.authSubject)),
          detail: {
            boundary: "authjs-jwt",
            reason: error instanceof Error ? error.name : "UNKNOWN",
          },
        });
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.authValid === true) {
        const active = session.user as typeof session.user & {
          activeInstitutionId: string; authMethod: string; authIssuer: string; authSubject: string; sessionId: string; sessionVersion: number;
        };
        active.id = String(token.userId);
        active.activeInstitutionId = String(token.activeInstitutionId);
        active.authMethod = String(token.authMethod);
        active.authIssuer = String(token.authIssuer);
        active.authSubject = String(token.authSubject);
        active.sessionId = String(token.sessionId);
        active.sessionVersion = Number(token.sessionVersion);
      } else if (session.user) {
        session.user.id = "";
      }
      return session;
    },
    async authorized({ auth: session, request }) {
      if (isPublicPath(request.nextUrl.pathname)) return true;
      try {
        assertProtectedAuthConfigured();
      } catch {
        await recordSecurityEventBestEffort({ eventClass: "AUTHENTICATION", eventCode: "AUTH_CONTRACT_UNAVAILABLE", detail: { boundary: "protected-route" } });
        return false;
      }
      const active = session?.user as ({ id?: string; sessionId?: string; sessionVersion?: number }) | undefined;
      const authorized = Boolean(active?.id && active.sessionId && Number(active.sessionVersion) > 0);
      if (!authorized) {
        await recordSecurityEventBestEffort({ eventClass: "AUTHENTICATION", eventCode: "UNAUTHENTICATED_PROTECTED_ACCESS", detail: { boundary: "authjs-authorized" } });
      }
      return authorized;
    },
  },
  events: {
    async signOut(message) {
      if ("token" in message && message.token?.sessionId && message.token.userId) {
        const revoked = await revokeAuthSession(String(message.token.sessionId), String(message.token.userId));
        await recordSecurityEventBestEffort({
          eventClass: "AUTHENTICATION",
          eventCode: revoked ? "SIGN_OUT_REVOKED" : "SIGN_OUT_SESSION_STALE",
          institutionId: message.token.activeInstitutionId ? String(message.token.activeInstitutionId) : undefined,
          actorUserId: String(message.token.userId),
          sessionId: String(message.token.sessionId),
          principal: message.token.authIssuer && message.token.authSubject
            ? redactedPrincipal(String(message.token.authIssuer), String(message.token.authSubject))
            : undefined,
          detail: { boundary: "authjs-signout" },
        });
      }
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
