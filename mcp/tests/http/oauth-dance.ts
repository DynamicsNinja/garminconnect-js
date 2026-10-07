/** A scripted MCP-client side of the OAuth flow, for the flow test and the live smoke script. */
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const REDIRECT = "http://127.0.0.1/callback";

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

const hiddenField = (page: string, name: string) => new RegExp(`name="${name}" value="([^"]*)"`).exec(page)?.[1];

export async function register(base: string, redirectUri = REDIRECT): Promise<string> {
  const res = await fetch(`${base}/mcp/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "test client", redirect_uris: [redirectUri], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
  });
  if (res.status !== 201) throw new Error(`register: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { client_id: string }).client_id;
}

export async function authorizePage(base: string, clientId: string, redirectUri: string, challenge: string, state = "st"): Promise<string> {
  const url = new URL(`${base}/mcp/oauth/authorize`);
  url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state }).toString();
  const res = await fetch(url);
  if (res.status !== 200) throw new Error(`authorize: ${res.status} ${await res.text()}`);
  return res.text();
}

export const postSignIn = (base: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  fetch(`${base}/mcp/oauth/signin`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields) });

export const tokenRequest = (base: string, fields: Record<string, string>) =>
  fetch(`${base}/mcp/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });

export async function signIn(base: string, o: { email: string; password: string; mfaCode?: () => Promise<string>; redirectUri?: string }) {
  const redirectUri = o.redirectUri ?? REDIRECT;
  const clientId = await register(base, redirectUri);
  const { verifier, challenge } = pkce();
  const page = await authorizePage(base, clientId, redirectUri, challenge);
  let res = await postSignIn(base, { step: "credentials", request: hiddenField(page, "request")!, email: o.email, password: o.password });
  if (res.status !== 302) {
    const mfa = hiddenField(await res.text(), "mfa");
    if (!mfa || !o.mfaCode) throw new Error(`sign-in did not redirect (HTTP ${res.status})`);
    res = await postSignIn(base, { step: "mfa", mfa, code: await o.mfaCode() });
    if (res.status !== 302) throw new Error(`MFA did not redirect (HTTP ${res.status})`);
  }
  const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
  const t = await tokenRequest(base, { grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri });
  if (t.status !== 200) throw new Error(`token: ${t.status} ${await t.text()}`);
  const body = (await t.json()) as { access_token: string; refresh_token: string };
  return { clientId, accessToken: body.access_token, refreshToken: body.refresh_token };
}

export async function mcpClient(base: string, accessToken: string): Promise<Client> {
  const client = new Client({ name: "oauth-dance", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } }));
  return client;
}
