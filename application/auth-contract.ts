import { z } from "zod";

export type AuthEnvironment = {
  NODE_ENV?: string;
  SYNTHETIC_SHOWCASE_MODE?: string;
  AUTH_OIDC_ISSUER?: string;
  AUTH_OIDC_CLIENT_ID?: string;
  AUTH_OIDC_CLIENT_SECRET?: string;
  AUTH_OIDC_INSTITUTION_CLAIM?: string;
};

function parseIssuer(value: string | undefined): string {
  const issuer = z.string().url().parse(value);
  const url = new URL(issuer);
  if (url.protocol !== "https:") throw new Error("OIDC issuer must use HTTPS");
  return issuer;
}

export type ProductionOidcContract = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  institutionClaim: string;
};

export function syntheticCredentialsAllowed(environment: AuthEnvironment = process.env): boolean {
  return environment.NODE_ENV !== "production" && environment.SYNTHETIC_SHOWCASE_MODE === "true";
}

export function resolveOidcContract(environment: AuthEnvironment = process.env): ProductionOidcContract | null {
  const values = [environment.AUTH_OIDC_ISSUER, environment.AUTH_OIDC_CLIENT_ID, environment.AUTH_OIDC_CLIENT_SECRET];
  if (values.every((value) => !value)) return null;
  if (values.some((value) => !value)) throw new Error("AUTH_OIDC_ISSUER, AUTH_OIDC_CLIENT_ID and AUTH_OIDC_CLIENT_SECRET must be configured together");
  return {
    issuer: parseIssuer(environment.AUTH_OIDC_ISSUER),
    clientId: z.string().min(1).parse(environment.AUTH_OIDC_CLIENT_ID),
    clientSecret: z.string().min(1).parse(environment.AUTH_OIDC_CLIENT_SECRET),
    institutionClaim: z.string().min(1).parse(environment.AUTH_OIDC_INSTITUTION_CLAIM ?? "institution_id"),
  };
}

export function assertProtectedAuthConfigured(environment: AuthEnvironment = process.env): void {
  if (environment.NODE_ENV === "production" && !resolveOidcContract(environment)) {
    throw new Error("Protected production access requires the OIDC server contract");
  }
}

export function isPublicPath(pathname: string): boolean {
  return pathname === "/sign-in"
    || pathname === "/api/health"
    || pathname.startsWith("/api/auth/");
}
