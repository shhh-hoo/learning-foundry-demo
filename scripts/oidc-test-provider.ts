/** Isolated local OIDC simulator for Playwright. It is never imported by runtime code. */
import { createHash, createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SEED } from "@/db/ids";

const host = "localhost";
const port = Number(process.env.OIDC_TEST_PORT ?? "3201");
const issuer = `https://${host}:${port}`;
const certificatePath = resolve(tmpdir(), "lf-rw02-oidc-cert.pem");
const keyPath = resolve(tmpdir(), "lf-rw02-oidc-key.pem");
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certificatePath, "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost", "-days", "1"], { stdio: "ignore" });
const clientId = "learning-foundry-e2e";
const clientSecret = "learning-foundry-e2e-secret";
const subject = "oidc-e2e-learner";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: "jwk" });
const codes = new Map<string, { nonce: string; challenge: string; redirectUri: string }>();

function json(response: import("node:http").ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function signIdToken(nonce: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "rw02-test-key" }));
  const payload = base64url(JSON.stringify({
    iss: issuer,
    aud: clientId,
    sub: subject,
    ...(nonce ? { nonce } : {}),
    iat: now,
    exp: now + 300,
    name: "OIDC E2E Learner",
    email: "different-email-proves-subject-binding@oidc.invalid",
    email_verified: true,
    institution_id: SEED.institution,
  }));
  const input = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(input).end().sign(privateKey);
  return `${input}.${base64url(signature)}`;
}

const server = createServer({ key: readFileSync(keyPath), cert: readFileSync(certificatePath) }, async (request, response) => {
  const url = new URL(request.url ?? "/", issuer);
  if (url.pathname === "/health") return json(response, { status: "ok" });
  if (url.pathname === "/.well-known/openid-configuration") {
    return json(response, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      scopes_supported: ["openid", "profile", "email"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      claims_supported: ["iss", "aud", "sub", "nonce", "name", "email", "email_verified", "institution_id"],
      code_challenge_methods_supported: ["S256"],
    });
  }
  if (url.pathname === "/jwks") return json(response, { keys: [{ ...publicJwk, use: "sig", alg: "RS256", kid: "rw02-test-key" }] });
  if (url.pathname === "/authorize") {
    if (url.searchParams.get("client_id") !== clientId || url.searchParams.get("response_type") !== "code") return json(response, { error: "invalid_request" }, 400);
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    const nonce = url.searchParams.get("nonce") ?? "";
    const challenge = url.searchParams.get("code_challenge");
    if (!redirectUri || !state || !challenge) return json(response, { error: "missing_security_parameter" }, 400);
    const code = randomUUID();
    codes.set(code, { nonce, challenge, redirectUri });
    const callback = new URL(redirectUri);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", state);
    response.writeHead(302, { location: callback.toString(), "cache-control": "no-store" });
    return response.end();
  }
  if (url.pathname === "/token" && request.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    const code = form.get("code");
    const record = code ? codes.get(code) : undefined;
    const basic = request.headers.authorization?.startsWith("Basic ") ? Buffer.from(request.headers.authorization.slice(6), "base64").toString("utf8") : "";
    const [basicId, basicSecret] = basic.split(":");
    const suppliedId = form.get("client_id") ?? basicId;
    const suppliedSecret = form.get("client_secret") ?? basicSecret;
    const verifier = form.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (!record || suppliedId !== clientId || suppliedSecret !== clientSecret || record.redirectUri !== form.get("redirect_uri") || record.challenge !== challenge) {
      console.error("OIDC test invalid_grant", {
        codeFound: Boolean(record),
        clientIdMatch: suppliedId === clientId,
        clientSecretMatch: suppliedSecret === clientSecret,
        redirectMatch: record?.redirectUri === form.get("redirect_uri"),
        pkceMatch: record?.challenge === challenge,
      });
      return json(response, { error: "invalid_grant" }, 400);
    }
    codes.delete(code!);
    return json(response, { access_token: randomUUID(), token_type: "Bearer", expires_in: 300, scope: "openid profile email", id_token: signIdToken(record.nonce) });
  }
  if (url.pathname === "/userinfo") return json(response, { sub: subject, name: "OIDC E2E Learner", email: "different-email-proves-subject-binding@oidc.invalid" });
  return json(response, { error: "not_found" }, 404);
});

server.listen(port, host, () => console.log(`Isolated HTTPS OIDC test provider listening at ${issuer}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
