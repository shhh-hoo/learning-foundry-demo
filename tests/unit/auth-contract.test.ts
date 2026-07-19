import { describe, expect, it } from "vitest";
import { assertProtectedAuthConfigured, isPublicPath, resolveOidcContract, syntheticCredentialsAllowed } from "@/application/auth-contract";

describe("production authentication contract", () => {
  it("makes synthetic Credentials impossible in production even when the flag is set", () => {
    expect(syntheticCredentialsAllowed({ NODE_ENV: "production", SYNTHETIC_SHOWCASE_MODE: "true" })).toBe(false);
    expect(syntheticCredentialsAllowed({ NODE_ENV: "test", SYNTHETIC_SHOWCASE_MODE: "true" })).toBe(true);
  });

  it("requires a complete HTTPS OIDC server contract for protected production access", () => {
    expect(() => assertProtectedAuthConfigured({ NODE_ENV: "production" })).toThrow(/requires the OIDC/);
    expect(() => resolveOidcContract({ NODE_ENV: "production", AUTH_OIDC_ISSUER: "https://id.example" })).toThrow(/configured together/);
    expect(() => resolveOidcContract({
      NODE_ENV: "production",
      AUTH_OIDC_ISSUER: "http://id.example",
      AUTH_OIDC_CLIENT_ID: "client",
      AUTH_OIDC_CLIENT_SECRET: "secret",
    })).toThrow(/HTTPS/);
    expect(resolveOidcContract({
      NODE_ENV: "production",
      AUTH_OIDC_ISSUER: "https://id.example",
      AUTH_OIDC_CLIENT_ID: "client",
      AUTH_OIDC_CLIENT_SECRET: "secret",
    })).toMatchObject({ issuer: "https://id.example", clientId: "client", institutionClaim: "institution_id" });
  });

  it("keeps the unauthenticated allowlist narrow", () => {
    expect(isPublicPath("/sign-in")).toBe(true);
    expect(isPublicPath("/api/auth/callback/oidc")).toBe(true);
    expect(isPublicPath("/api/health")).toBe(true);
    for (const path of ["/", "/learner", "/teacher", "/foundry", "/engineering", "/api/tasks", "/api/health/private"]) {
      expect(isPublicPath(path)).toBe(false);
    }
  });
});
