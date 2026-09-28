import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Garmin, GarminClient, type Tokens } from "garminconnect-js";
import { createServer, type ServerDeps, type ToolFactory } from "../src/server.js";
import type { McpConfig, Session } from "../src/session.js";

export const TOKENS: Tokens = {
  oauth1: { oauth_token: "o1", oauth_token_secret: "s1", domain: "garmin.com" },
  oauth2: {
    scope: "CONNECT_READ",
    jti: "j",
    token_type: "Bearer",
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token_expires_in: 7200,
    refresh_token_expires_at: Math.floor(Date.now() / 1000) + 7200,
  },
};

export interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

/**
 * A fetch stand-in. `routes` maps "METHOD url-fragment" to a response; the first match wins.
 * An unmatched request throws, which the client surfaces as a failure, so tests notice it.
 */
export function fakeFetch(routes: Record<string, (call: FetchCall) => Response>) {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : init?.body;
    const call = { url, method, body };
    calls.push(call);
    for (const [key, respond] of Object.entries(routes)) {
      const [routeMethod, fragment] = key.split(" ", 2);
      if (routeMethod === method && fragment !== undefined && url.includes(fragment)) return respond(call);
    }
    throw new Error(`fakeFetch: no route for ${method} ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

export const PROFILE_ROUTE = {
  "GET /userprofile-service/socialProfile": () =>
    json({ displayName: "abc-display", userName: "u", fullName: "Test User", profileId: 1 }),
};

export function testConfig(overrides: Partial<McpConfig> = {}): McpConfig {
  return { tokenDir: "/nonexistent", downloadDir: os.tmpdir(), groups: null, enableGraphql: false, ...overrides };
}

/** A session over an in-memory client that talks to `fetchImpl`, counting resets. */
export function sessionFor(fetchImpl: typeof fetch): Session & { resets: number } {
  const client = new GarminClient({ fetchImpl, retries: 0 });
  client.setTokens(TOKENS);
  const garmin = new Garmin(client);
  const session = {
    resets: 0,
    get: async () => garmin,
    reset() {
      session.resets++;
    },
  };
  return session;
}

export async function connect(deps: ServerDeps, factories: readonly ToolFactory[]): Promise<Client> {
  const server = createServer(deps, factories);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return client;
}

export function textOf(result: unknown): string {
  return (result as { content: { text?: string }[] }).content.map((c) => c.text ?? "").join("\n");
}
