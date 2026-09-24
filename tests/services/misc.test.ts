import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { FileTokenStore, MemoryTokenStore } from "../../src/auth/token-store.js";
import type { Tokens } from "../../src/auth/tokens.js";

const API = "https://connectapi.garmin.com";
const seen: { url: string; method: string; body?: unknown }[] = [];

async function record(request: Request) {
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    body = undefined;
  }
  seen.push({ url: request.url, method: request.method, body });
}

const server = setupServer(
  http.get(`${API}/lifestylelogging-service/dailyLog/:cdate`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ foo: "bar" });
  }),

  http.post(
    `${API}/wellness-service/wellness/epoch/request/:cdate`,
    async ({ request }) => {
      await record(request);
      return HttpResponse.json({ requested: true });
    },
  ),

  http.post(`${API}/graphql-gateway/graphql`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ data: { ok: true } });
  }),
);

const tokens: Tokens = {
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

function makeGarmin(): Garmin {
  const client = new GarminClient();
  client.setTokens(tokens);
  return new Garmin(client);
}

beforeEach(() => {
  seen.length = 0;
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("getLifestyleLoggingData", () => {
  it("hits lifestylelogging-service/dailyLog/{cdate}", async () => {
    const result = await makeGarmin().getLifestyleLoggingData("2026-09-22");
    expect(seen[0]!.url).toBe(`${API}/lifestylelogging-service/dailyLog/2026-09-22`);
    expect(seen[0]!.method).toBe("GET");
    expect(result).toEqual({ foo: "bar" });
  });

  it("routes a Date through formatDate", async () => {
    await makeGarmin().getLifestyleLoggingData(new Date("2026-01-05T00:00:00.000Z"));
    expect(seen[0]!.url).toBe(`${API}/lifestylelogging-service/dailyLog/2026-01-05`);
  });
});

describe("requestReload", () => {
  it("POSTs wellness-service/wellness/epoch/request/{cdate} with no body", async () => {
    const result = await makeGarmin().requestReload("2026-09-22");
    expect(seen[0]!.url).toBe(
      `${API}/wellness-service/wellness/epoch/request/2026-09-22`,
    );
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.body).toBeUndefined();
    expect(result).toEqual({ requested: true });
  });
});

describe("queryGarminGraphql", () => {
  /**
   * The single highest-risk assertion in this task. Upstream's own constant for this endpoint is
   * `"graphql-gateway/graphql"` — no leading slash, unlike every other endpoint constant in
   * `gc.py`. This client's `GarminClient#apiRequest` composes the request URL via plain string
   * concatenation (`` `https://connectapi.${domain}${path}` ``), NOT `URL`-relative joining, so a
   * path without a leading slash would glue onto the hostname
   * (`https://connectapi.garmin.comgraphql-gateway/graphql`) rather than start a new path segment
   * — a malformed host, not a 404, meaning the usual "a 404 means the URL is wrong" heuristic
   * would not even catch it. This test pins the ACTUAL composed URL literally, proving
   * `queryGarminGraphql` prepends the slash `connectapi`'s string-concat join requires.
   */
  it("POSTs the caller's query verbatim to /graphql-gateway/graphql — WITH a leading slash", async () => {
    const query = { query: "{ __typename }", variables: { a: 1 } };
    const result = await makeGarmin().queryGarminGraphql(query);
    expect(seen[0]!.url).toBe(`${API}/graphql-gateway/graphql`);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.body).toEqual(query);
    expect(result).toEqual({ data: { ok: true } });
  });
});

describe("logout", () => {
  it("clears a MemoryTokenStore and makes no HTTP call", async () => {
    const store = new MemoryTokenStore();
    await store.save(tokens);
    const client = new GarminClient({ tokenStore: store });
    client.setTokens(tokens);
    const garmin = new Garmin(client);

    await garmin.logout();

    expect(seen).toEqual([]); // no HTTP call, matching upstream
    expect(await store.load()).toBeNull();
  });

  it("does NOT clear the calling client's in-memory tokens — the documented trap", async () => {
    // AGENTS.md warns that a process which calls logout() and keeps using the SAME GarminClient
    // goes on succeeding until the access token ages out (~27h), because logout only empties the
    // TokenStore. That is a real behavioural claim and nothing pinned it: if someone later makes
    // logout clear the instance too, the warning becomes wrong silently and callers who relied on
    // it are none the wiser. Asserted here so the doc and the code have to move together.
    const store = new MemoryTokenStore();
    await store.save(tokens);
    const client = new GarminClient({ tokenStore: store });
    client.setTokens(tokens);
    const garmin = new Garmin(client);

    await garmin.logout();

    expect(await store.load(), "the store is emptied").toBeNull();
    expect(
      client.getTokens(),
      "but the instance keeps its tokens — discard the client after logout()",
    ).not.toBeNull();
  });

  it("clears a FileTokenStore (on-disk tokens are actually deleted)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "garmin-logout-test-"));
    try {
      const store = new FileTokenStore(dir);
      await store.save(tokens);
      expect(await store.load()).not.toBeNull();

      const client = new GarminClient({ tokenStore: store });
      client.setTokens(tokens);
      const garmin = new Garmin(client);

      await garmin.logout();

      expect(await store.load()).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
