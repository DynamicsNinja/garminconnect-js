import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// eslint-disable-next-line no-restricted-imports
import { createHttpApp } from "../../src/http/app.js";
// eslint-disable-next-line no-restricted-imports
import { loadSqlite, MemoryGrantStore, SqliteGrantStore, type GrantStore } from "../../src/http/grants.js";
// eslint-disable-next-line no-restricted-imports
import { Sealer } from "../../src/http/seal.js";
import { fakeFetch, json, PROFILE_ROUTE, testConfig, textOf } from "../helpers.js";
import { fakeAuth, MFA_CODE, PASSWORD, SECRET_TOKENS } from "./fakes.js";
import { authorizePage, mcpClient, pkce, postSignIn, register, REDIRECT, signIn, tokenRequest } from "./oauth-dance.js";

// The hosted server runs on Node 22 (its Docker image). The MCP SDK's streamable-HTTP transport
// uses the global WebCrypto object, which Node 18 lacks, so this end-to-end suite needs Node 20+.
const NODE_MAJOR = Number(process.versions.node.split(".")[0]);

const sqliteAvailable = loadSqlite() !== null;
const servers: http.Server[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.close());
  vi.restoreAllMocks();
});

async function start(o: { grants?: GrantStore; routes?: Parameters<typeof fakeFetch>[0]; trustProxy?: boolean } = {}) {
  const server = http.createServer();
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const grants = o.grants ?? new MemoryGrantStore();
  const { fetchImpl } = fakeFetch(o.routes ?? PROFILE_ROUTE);
  server.on("request", createHttpApp({
    publicUrl: new URL(base), sealer: new Sealer([randomBytes(32)]), grants, auth: fakeAuth(), mcp: testConfig(),
    version: "test", trustProxy: o.trustProxy, garminClient: { fetchImpl, retries: 0 }, log: () => {},
  }));
  return { base, grants };
}

describe.skipIf(NODE_MAJOR < 20)("hosted MCP over HTTP", () => {
  it("answers health checks, and 405 for GET/DELETE /mcp", async () => {
    const { base } = await start();
    expect(await (await fetch(`${base}/mcp/healthz`)).text()).toBe("ok");
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
    expect((await fetch(`${base}/mcp`, { method: "DELETE" })).status).toBe(405);
  });

  it("challenges an unauthenticated client and publishes discovery metadata", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`);
    const prm = (await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json()) as Record<string, unknown>;
    expect(prm).toMatchObject({ resource: `${base}/mcp`, authorization_servers: [`${base}/`] });
    const as = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    expect(as).toMatchObject({
      authorization_endpoint: `${base}/mcp/oauth/authorize`,
      token_endpoint: `${base}/mcp/oauth/token`,
      registration_endpoint: `${base}/mcp/oauth/register`,
      revocation_endpoint: `${base}/mcp/oauth/revoke`,
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("signs in, lists the hosted tools and runs one", async () => {
    const { base } = await start();
    const { accessToken } = await signIn(base, { email: "a@b.c", password: PASSWORD });
    const client = await mcpClient(base, accessToken);
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name)).not.toContain("sign_in_to_garmin");
    expect(tools.find((t) => t.name === "import_activity")?.inputSchema.properties).toHaveProperty("content");
    expect(textOf(await client.callTool({ name: "get_user_profile", arguments: {} }))).toContain("abc-display");
    await client.close();
  });

  it("completes an MFA sign-in", async () => {
    const { base } = await start();
    const { accessToken } = await signIn(base, { email: "mfa@b.c", password: PASSWORD, mfaCode: async () => MFA_CODE });
    expect(accessToken).toBeTruthy();
  });

  it("rejects a wrong PKCE verifier and a reused code", async () => {
    const { base } = await start();
    const clientId = await register(base);
    const { verifier, challenge } = pkce();
    const page = await authorizePage(base, clientId, REDIRECT, challenge);
    const request = /name="request" value="([^"]*)"/.exec(page)![1]!;
    const res = await postSignIn(base, { step: "credentials", request, email: "a@b.c", password: PASSWORD });
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
    const fields = { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT };
    expect((await tokenRequest(base, { ...fields, code_verifier: pkce().verifier })).status).toBe(400);
    expect((await tokenRequest(base, { ...fields, code_verifier: verifier })).status).toBe(200);
    expect((await tokenRequest(base, { ...fields, code_verifier: verifier })).status).toBe(400);
  });

  it("rotates refresh tokens and disconnects on a late replay", async () => {
    const { base } = await start();
    const first = await signIn(base, { email: "a@b.c", password: PASSWORD });
    const refresh = (token: string) => tokenRequest(base, { grant_type: "refresh_token", refresh_token: token, client_id: first.clientId });
    const second = (await (await refresh(first.refreshToken)).json()) as { access_token: string; refresh_token: string };
    expect((await mcpClient(base, second.access_token)).getServerVersion()?.name).toBe("garminconnect-mcp");
    await refresh(second.refresh_token); // generation 2: the first refresh token is now two behind
    expect((await refresh(first.refreshToken)).status).toBe(400);
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${second.access_token}`, "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
  });

  it("disconnects when Garmin rejects the session during a tool call", async () => {
    const { base } = await start({ routes: { "GET /userprofile-service/socialProfile": () => json({ message: "no" }, 401) } });
    const { accessToken } = await signIn(base, { email: "a@b.c", password: PASSWORD });
    const client = await mcpClient(base, accessToken);
    const result = await client.callTool({ name: "get_user_profile", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/reconnect the Garmin connector/);
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
  });

  it("caps OAuth endpoint bodies at 16 KB", async () => {
    const { base } = await start();
    const token = await tokenRequest(base, { grant_type: "refresh_token", refresh_token: "x".repeat(20_000) });
    expect(token.status).toBe(413);
    const reg = await fetch(`${base}/mcp/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "x".repeat(20_000) }) });
    expect(reg.status).toBe(413);
  });

  it("rate-limits sign-in per real client IP behind a proxy", async () => {
    const { base } = await start({ trustProxy: true });
    const attempt = (ip: string) => postSignIn(base, { step: "credentials", request: "x", email: "a", password: "b" }, { "x-forwarded-for": ip });
    for (let i = 0; i < 5; i++) expect((await attempt("203.0.113.1")).status).toBe(400);
    expect((await attempt("203.0.113.1")).status).toBe(429);
    expect((await attempt("203.0.113.2")).status).toBe(400);
  });

  it("does not count successful sign-ins against the per-IP limit", async () => {
    const { base } = await start();
    for (let i = 0; i < 7; i++) await expect(signIn(base, { email: "a@b.c", password: PASSWORD })).resolves.toBeDefined();
  });

  it("caps sign-in attempts across all IPs at 100 per 15 minutes", async () => {
    const { base } = await start({ trustProxy: true });
    const attempt = (i: number) => postSignIn(base, { step: "credentials", request: "x", email: "a", password: "b" }, { "x-forwarded-for": `198.51.100.${i}` });
    for (let i = 0; i < 100; i++) expect((await attempt(i)).status).toBe(400);
    const capped = await attempt(200);
    expect(capped.status).toBe(429);
    expect(await capped.text()).toContain("<html");
  });

  it("keeps a confidential client's secret valid past 30 days", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/mcp/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "confidential", redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_post", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
    });
    const { client_id, client_secret } = (await res.json()) as { client_id: string; client_secret: string };
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow + 31 * 86_400_000);
    const refresh = (secret: string) => tokenRequest(base, { grant_type: "refresh_token", refresh_token: "not-a-token", client_id, client_secret: secret });
    // Client authentication passes (invalid_grant is about the token), where an expired secret would be invalid_client.
    expect(await (await refresh(client_secret)).json()).toMatchObject({ error: "invalid_grant" });
    expect(await (await refresh("wrong")).json()).toMatchObject({ error: "invalid_client" });
  });

  it.skipIf(!sqliteAvailable)("never writes Garmin tokens, emails or passwords to the database", async () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), "flow-")), "grants.db");
    const grants = await SqliteGrantStore.open(file);
    const { base } = await start({ grants });
    const email = "secret-email@example.com";
    const { accessToken } = await signIn(base, { email, password: PASSWORD });
    await (await mcpClient(base, accessToken)).callTool({ name: "get_user_profile", arguments: {} });
    grants.close();
    const bytes = [file, `${file}-wal`].filter(existsSync).map((f) => readFileSync(f).toString("latin1")).join("");
    for (const secret of [email, PASSWORD, SECRET_TOKENS.oauth1.oauth_token_secret, SECRET_TOKENS.oauth2.access_token, SECRET_TOKENS.oauth2.refresh_token]) {
      expect(bytes).not.toContain(secret);
    }
  });
});
