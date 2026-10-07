import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { InvalidGrantError, InvalidTokenError, ServerError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { GarminAuthError, GarminError, GarminRateLimitError } from "garminconnect-js";
// eslint-disable-next-line no-restricted-imports
import { MemoryGrantStore } from "../../src/http/grants.js";
// eslint-disable-next-line no-restricted-imports
import { ACCESS_TTL_S, CODE_TTL_S, FORM_TTL_S, HostedOAuthProvider, REFRESH_WITHIN_MS, type AccessExtra } from "../../src/http/provider.js";
// eslint-disable-next-line no-restricted-imports
import { Sealer } from "../../src/http/seal.js";
import { fakeAuth, fakeRes, hidden, MFA_CODE, PASSWORD, SECRET_TOKENS, type FakeAuth } from "./fakes.js";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const key = randomBytes(32);

let clock: number;
let grants: MemoryGrantStore;
let auth: FakeAuth;
let provider: HostedOAuthProvider;
let client: OAuthClientInformationFull;
let logged: Record<string, unknown>[];

const make = (keys = [key]) =>
  new HostedOAuthProvider({ sealer: new Sealer(keys, () => clock), grants, auth, signInPath: "/mcp/oauth/signin", now: () => clock, log: (line) => logged.push(line) });

beforeEach(async () => {
  clock = 1_000_000;
  logged = [];
  grants = new MemoryGrantStore();
  auth = fakeAuth();
  provider = make();
  client = await provider.clientsStore.registerClient!({ redirect_uris: [REDIRECT], client_name: "Claude", token_endpoint_auth_method: "none" });
});

async function formFor(redirectUri = REDIRECT, state = "st") {
  const res = fakeRes();
  await provider.authorize({ ...client, redirect_uris: [redirectUri] }, { redirectUri, codeChallenge: "CHALLENGE", state, scopes: [] }, res);
  return { res, request: hidden(res.body, "request")! };
}

async function signIn(email = "a@b.c") {
  const { request } = await formFor();
  const outcome = await provider.handleSignIn({ step: "credentials", request, email, password: PASSWORD });
  if (outcome.kind !== "redirect") throw new Error(`no redirect: ${outcome.body}`);
  return new URL(outcome.location).searchParams.get("code")!;
}

async function tokens(email?: string) {
  return provider.exchangeAuthorizationCode(client, await signIn(email));
}

describe("client registration", () => {
  it("round-trips a registration through the sealed client_id", async () => {
    expect(await provider.clientsStore.getClient(client.client_id)).toMatchObject({ client_name: "Claude", redirect_uris: [REDIRECT], client_id: client.client_id });
    expect(await provider.clientsStore.getClient("garbage")).toBeUndefined();
  });
});

describe("sign-in", () => {
  it("renders the form with sealed request state and a CSP that allows the redirect", async () => {
    const { res, request } = await formFor();
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-security-policy"]).toContain("form-action 'self' https://claude.ai");
    expect(request).toBeTruthy();
    expect(res.body).toContain("Claude");
  });

  it("redirects with a code and the state, and leaves a pending grant", async () => {
    const { request } = await formFor();
    const outcome = await provider.handleSignIn({ step: "credentials", request, email: "a@b.c", password: PASSWORD });
    expect(outcome.kind).toBe("redirect");
    const url = new URL((outcome as { location: string }).location);
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("st");
    expect(grants.count()).toEqual({ active: 0, total: 1 });
  });

  it("keeps query strings and custom schemes in the redirect", async () => {
    for (const redirectUri of ["https://x.example/cb?a=1", "cursor://anysphere.cursor-retrieval/oauth/callback"]) {
      const { request } = await formFor(redirectUri);
      const outcome = await provider.handleSignIn({ step: "credentials", request, email: "a@b.c", password: PASSWORD, confirmRedirect: "1" });
      const url = new URL((outcome as { location: string }).location);
      expect(url.href.startsWith(redirectUri)).toBe(true);
      expect(url.searchParams.get("code")).toBeTruthy();
      if (redirectUri.includes("?a=1")) expect(url.searchParams.get("a")).toBe("1");
    }
  });

  it("shows the redirect target on the form", async () => {
    const { res } = await formFor("https://evil.example/cb");
    expect(res.body).toContain("<strong>evil.example</strong>");
    expect(res.body).toContain('name="confirmRedirect"');
  });

  it("needs no confirmation for trusted redirect targets", async () => {
    for (const redirectUri of [REDIRECT, "http://127.0.0.1:33418/callback", "cursor://anysphere.cursor-retrieval/oauth/callback"]) {
      const { request } = await formFor(redirectUri);
      expect(await provider.handleSignIn({ step: "credentials", request, email: "a@b.c", password: PASSWORD }), redirectUri).toMatchObject({ kind: "redirect" });
    }
  });

  it("refuses an untrusted redirect target without the confirmation, never calling Garmin", async () => {
    let logins = 0;
    const login = auth.login.bind(auth);
    auth.login = async (email, password) => (logins++, login(email, password));
    const { request } = await formFor("https://evil.example/cb");
    const refused = await provider.handleSignIn({ step: "credentials", request, email: "a@b.c", password: PASSWORD });
    expect(refused).toMatchObject({ kind: "page", status: 400 });
    expect((refused as { body: string }).body).toContain("evil.example");
    expect(hidden((refused as { body: string }).body, "request")).toBe(request);
    expect(logins).toBe(0);
    expect(grants.count().total).toBe(0);
    const confirmed = await provider.handleSignIn({ step: "credentials", request, email: "a@b.c", password: PASSWORD, confirmRedirect: "1" });
    expect(confirmed).toMatchObject({ kind: "redirect" });
    expect(new URL((confirmed as { location: string }).location).host).toBe("evil.example");
    expect(logins).toBe(1);
  });

  it("carries the confirmation through MFA", async () => {
    const { request } = await formFor("https://evil.example/cb");
    const first = await provider.handleSignIn({ step: "credentials", request, email: "mfa@b.c", password: PASSWORD, confirmRedirect: "1" });
    const mfa = hidden((first as { body: string }).body, "mfa")!;
    expect(await provider.handleSignIn({ step: "mfa", mfa, code: MFA_CODE })).toMatchObject({ kind: "redirect" });
  });

  it("explains sign-in errors in plain words", async () => {
    const cases: [Error, string][] = [
      [new GarminAuthError("SSO error: INVALID_CREDENTIALS"), "Garmin didn't accept that email/username and password."],
      [new GarminAuthError("SSO error: ACCOUNT_RESTRICTED"), "Garmin has restricted this account. Sign in at connect.garmin.com to see why."],
      [new GarminRateLimitError("Too many requests"), "Garmin is limiting sign-ins right now. Wait a few minutes and try again."],
      [new GarminError("Unexpected SSO response"), "Sign-in failed: Unexpected SSO response"],
      [new TypeError("x is undefined"), "Something went wrong signing you in. Try again in a minute."],
    ];
    for (const [error, message] of cases) {
      auth.login = async () => {
        throw error;
      };
      const { request } = await formFor();
      const outcome = await provider.handleSignIn({ step: "credentials", request, email: "a@b.c", password: PASSWORD });
      expect((outcome as { body: string }).body, error.message).toContain(escapeHtml(message));
      expect((outcome as { body: string }).body).not.toContain("x is undefined");
    }
  });

  it("explains a wrong MFA code in plain words", async () => {
    const { request } = await formFor();
    const first = await provider.handleSignIn({ step: "credentials", request, email: "mfa@b.c", password: PASSWORD });
    const mfa = hidden((first as { body: string }).body, "mfa")!;
    const wrong = await provider.handleSignIn({ step: "mfa", mfa, code: "000000" });
    expect((wrong as { body: string }).body).toContain(escapeHtml("That verification code wasn't accepted. Try again."));
  });

  it("logs a Garmin rate limit, without the email", async () => {
    auth.login = async () => {
      throw new GarminRateLimitError("Too many requests");
    };
    const { request } = await formFor();
    await provider.handleSignIn({ step: "credentials", request, email: "secret@b.c", password: PASSWORD });
    expect(logged).toEqual([{ msg: "garmin rate limited" }]);
    expect(JSON.stringify(logged)).not.toContain("secret@b.c");
  });

  it("shows a wrong password on the form, with no grant", async () => {
    const { request } = await formFor();
    const outcome = await provider.handleSignIn({ step: "credentials", request, email: "a@b.c", password: "nope" });
    expect(outcome).toMatchObject({ kind: "page", status: 400 });
    expect((outcome as { body: string }).body).toContain(escapeHtml("Garmin didn't accept that email/username and password."));
    expect((outcome as { body: string }).body).toContain('value="a@b.c"');
    expect(grants.count().total).toBe(0);
  });

  it("goes through MFA, lets a wrong code be retried, then redirects", async () => {
    const { request } = await formFor();
    const first = await provider.handleSignIn({ step: "credentials", request, email: "mfa@b.c", password: PASSWORD });
    const mfa = hidden((first as { body: string }).body, "mfa")!;
    const wrong = await provider.handleSignIn({ step: "mfa", mfa, code: "000000" });
    expect(wrong).toMatchObject({ kind: "page", status: 400 });
    expect(hidden((wrong as { body: string }).body, "mfa")).toBe(mfa);
    expect(await provider.handleSignIn({ step: "mfa", mfa, code: MFA_CODE })).toMatchObject({ kind: "redirect" });
  });

  it("explains an expired form or MFA step instead of failing", async () => {
    const { request } = await formFor();
    const first = await provider.handleSignIn({ step: "credentials", request, email: "mfa@b.c", password: PASSWORD });
    const mfa = hidden((first as { body: string }).body, "mfa")!;
    clock += FORM_TTL_S;
    for (const form of [{ step: "credentials", request, email: "a@b.c", password: PASSWORD }, { step: "mfa", mfa, code: MFA_CODE }]) {
      const outcome = await provider.handleSignIn(form);
      expect(outcome).toMatchObject({ kind: "page", status: 400 });
      expect((outcome as { body: string }).body).toContain("expired");
    }
  });

  it("asks for both fields when one is missing", async () => {
    const { request } = await formFor();
    expect(await provider.handleSignIn({ step: "credentials", request, email: "", password: "" })).toMatchObject({ kind: "page", status: 400 });
  });

  it("disconnects the user's other connections when asked", async () => {
    const first = await tokens();
    const { request } = await formFor();
    await provider.handleSignIn({ step: "credentials", request, email: "a@b.c", password: PASSWORD, disconnectOthers: "1" });
    await expect(provider.verifyAccessToken(first.access_token)).rejects.toThrow(InvalidTokenError);
  });

  it("survives a restart and a key rotation between form, code and token", async () => {
    const { request } = await formFor(); // sealed under `key`
    const rotated = randomBytes(32);
    provider = make([rotated, key]); // new process, new key prepended
    const outcome = await provider.handleSignIn({ step: "credentials", request, email: "a@b.c", password: PASSWORD });
    const code = new URL((outcome as { location: string }).location).searchParams.get("code")!;
    const t = await make([rotated, key]).exchangeAuthorizationCode(client, code); // yet another process
    expect(await make([rotated, key]).verifyAccessToken(t.access_token)).toMatchObject({ clientId: client.client_id });
  });
});

describe("codes", () => {
  it("returns the PKCE challenge and exchanges once", async () => {
    const code = await signIn();
    expect(await provider.challengeForAuthorizationCode(client, code)).toBe("CHALLENGE");
    const t = await provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT);
    expect(t).toMatchObject({ token_type: "bearer", expires_in: ACCESS_TTL_S });
    await expect(provider.exchangeAuthorizationCode(client, code)).rejects.toThrow(/already been used/);
  });

  it("disconnects the tokens issued from a code that is replayed", async () => {
    const code = await signIn();
    const t = await provider.exchangeAuthorizationCode(client, code);
    await expect(provider.verifyAccessToken(t.access_token)).resolves.toBeDefined();
    await expect(provider.exchangeAuthorizationCode(client, code)).rejects.toThrow(/already been used/);
    await expect(provider.verifyAccessToken(t.access_token)).rejects.toThrow(/disconnected/);
    await expect(provider.exchangeRefreshToken(client, t.refresh_token!)).rejects.toThrow(InvalidGrantError);
  });

  it("refuses another client, another redirect, and an expired code", async () => {
    const other = await provider.clientsStore.registerClient!({ redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
    const code = await signIn();
    await expect(provider.exchangeAuthorizationCode(other, code)).rejects.toThrow(InvalidGrantError);
    await expect(provider.exchangeAuthorizationCode(client, code, undefined, "https://evil.example/cb")).rejects.toThrow(InvalidGrantError);
    const late = await signIn();
    clock += CODE_TTL_S;
    await expect(provider.exchangeAuthorizationCode(client, late)).rejects.toThrow(InvalidGrantError);
  });
});

describe("access tokens", () => {
  it("verify to the grant and the Garmin tokens", async () => {
    const t = await tokens();
    const info = await provider.verifyAccessToken(t.access_token);
    expect(info.expiresAt).toBe(clock + ACCESS_TTL_S);
    expect((info.extra as unknown as AccessExtra).tokens).toEqual(SECRET_TOKENS);
  });

  it("stop working when expired or revoked", async () => {
    const t = await tokens();
    await provider.revokeToken(client, { token: t.refresh_token! });
    await expect(provider.verifyAccessToken(t.access_token)).rejects.toThrow(/disconnected/);
    const u = await tokens();
    clock += ACCESS_TTL_S;
    await expect(provider.verifyAccessToken(u.access_token)).rejects.toThrow(InvalidTokenError);
  });
});

describe("refresh", () => {
  it("refreshes Garmin within the 2 h window and rotates", async () => {
    const t = await tokens();
    let windowSeen = 0;
    const refresh = auth.refresh.bind(auth);
    auth.refresh = async (tk, within) => ((windowSeen = within), refresh(tk, within));
    const next = await provider.exchangeRefreshToken(client, t.refresh_token!);
    expect(windowSeen).toBe(REFRESH_WITHIN_MS);
    const info = await provider.verifyAccessToken(next.access_token);
    expect((info.extra as unknown as AccessExtra).tokens.oauth2.access_token).toBe("REFRESHED-1");
  });

  it("tolerates a racing duplicate within the grace window, revokes a later replay", async () => {
    const t = await tokens();
    await provider.exchangeRefreshToken(client, t.refresh_token!);
    await expect(provider.exchangeRefreshToken(client, t.refresh_token!)).resolves.toBeDefined();
    clock += 61;
    await expect(provider.exchangeRefreshToken(client, t.refresh_token!)).rejects.toThrow(/already used/);
    await expect(provider.verifyAccessToken((await tokens()).access_token)).resolves.toBeDefined(); // a new sign-in still works
  });

  it("disconnects when Garmin says the session is dead", async () => {
    const t = await tokens();
    auth.failRefresh = new GarminAuthError("Refresh token expired; log in again");
    await expect(provider.exchangeRefreshToken(client, t.refresh_token!)).rejects.toThrow(/sign in again/);
    await expect(provider.verifyAccessToken(t.access_token)).rejects.toThrow(/disconnected/);
  });

  it("keeps the connection on a transient Garmin failure, so a retry works", async () => {
    const t = await tokens();
    auth.failRefresh = new GarminAuthError("Not authorized for x (403)");
    await expect(provider.exchangeRefreshToken(client, t.refresh_token!)).rejects.toThrow(ServerError);
    auth.failRefresh = null;
    await expect(provider.exchangeRefreshToken(client, t.refresh_token!)).resolves.toBeDefined();
  });

  it("refuses another client's refresh token", async () => {
    const other = await provider.clientsStore.registerClient!({ redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
    const t = await tokens();
    await expect(provider.exchangeRefreshToken(other, t.refresh_token!)).rejects.toThrow(InvalidGrantError);
  });
});
