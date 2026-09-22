import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../src/client.js";
import { MemoryTokenStore } from "../src/auth/token-store.js";
import { GarminAuthError, GarminError } from "../src/errors.js";
import { resetConsumerCache } from "../src/auth/consumer.js";
import type { Tokens } from "../src/auth/tokens.js";

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 10;

function tokensWith(expiresAt: number): Tokens {
  return {
    oauth1: { oauth_token: "o1tok", oauth_token_secret: "o1sec", domain: "garmin.com" },
    oauth2: {
      scope: "CONNECT_READ",
      jti: "j",
      token_type: "Bearer",
      access_token: "old-access",
      refresh_token: "rt",
      expires_in: 3600,
      expires_at: expiresAt,
      refresh_token_expires_in: 7200,
      refresh_token_expires_at: future,
    },
  };
}

/** A refresh token that is itself already expired — the short-circuit path. */
function tokensWithExpiredRefresh(): Tokens {
  return {
    oauth1: { oauth_token: "o1tok", oauth_token_secret: "o1sec", domain: "garmin.com" },
    oauth2: {
      scope: "CONNECT_READ",
      jti: "j",
      token_type: "Bearer",
      access_token: "old-access",
      refresh_token: "rt",
      expires_in: 3600,
      expires_at: past,
      refresh_token_expires_in: 7200,
      refresh_token_expires_at: past,
    },
  };
}

let exchangeCount = 0;
let seenAuth: string[] = [];

const server = setupServer(
  http.get("https://thegarth.s3.amazonaws.com/oauth_consumer.json", () =>
    HttpResponse.json({ consumer_key: "ck", consumer_secret: "cs" }),
  ),
  http.post(
    "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0",
    () => {
      exchangeCount++;
      return HttpResponse.json({
        scope: "CONNECT_READ",
        jti: "j2",
        token_type: "Bearer",
        access_token: "fresh-access",
        refresh_token: "rt2",
        expires_in: 3600,
        refresh_token_expires_in: 7200,
      });
    },
  ),
  http.get("https://connectapi.garmin.com/thing", ({ request }) => {
    seenAuth.push(request.headers.get("authorization") ?? "");
    return HttpResponse.json({ ok: true });
  }),
  http.get("https://connectapi.garmin.com/empty", () => new HttpResponse(null, { status: 204 })),
  http.get("https://connectapi.garmin.com/file", () =>
    HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3]).buffer),
  ),
  http.post("https://connectapi.garmin.com/upload-service/upload", async ({ request }) => {
    const form = await request.formData();
    const file = form.get("file") as File;
    return HttpResponse.json({ name: file.name, size: file.size });
  }),
  http.get("https://connectapi.garmin.com/forbidden", () => new HttpResponse("no", { status: 401 })),
);

beforeEach(() => {
  exchangeCount = 0;
  seenAuth = [];
  resetConsumerCache();
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  // Undo any per-test `server.use(...)` overrides before the next test's
  // `server.listen()` — otherwise a handler swapped in for one test (e.g. an
  // exchange endpoint that fails) can silently leak into the next.
  server.resetHandlers();
  server.close();
});

describe("GarminClient", () => {
  it("throws GarminAuthError when no tokens are loaded", async () => {
    const client = new GarminClient();
    await expect(client.connectapi("/thing")).rejects.toThrow(GarminAuthError);
  });

  it("sends the bearer token on API calls", async () => {
    const client = new GarminClient();
    client.setTokens(tokensWith(future));
    await expect(client.connectapi("/thing")).resolves.toEqual({ ok: true });
    expect(seenAuth[0]).toBe("Bearer old-access");
  });

  it("loads tokens from the store", async () => {
    const store = new MemoryTokenStore();
    await store.save(tokensWith(future));
    const client = new GarminClient({ tokenStore: store });
    await expect(client.loadTokens()).resolves.toBe(true);
    await expect(client.connectapi("/thing")).resolves.toEqual({ ok: true });
  });

  it("loadTokens returns false on an empty store", async () => {
    const client = new GarminClient({ tokenStore: new MemoryTokenStore() });
    await expect(client.loadTokens()).resolves.toBe(false);
  });

  it("refreshes an expired access token before the call and persists it", async () => {
    const store = new MemoryTokenStore();
    await store.save(tokensWith(past));
    const client = new GarminClient({ tokenStore: store });
    await client.loadTokens();

    await client.connectapi("/thing");

    expect(exchangeCount).toBe(1);
    expect(seenAuth[0]).toBe("Bearer fresh-access");
    const saved = await store.load();
    expect(saved?.oauth2.access_token).toBe("fresh-access");
  });

  it("does not refresh a valid token", async () => {
    const client = new GarminClient();
    client.setTokens(tokensWith(future));
    await client.connectapi("/thing");
    expect(exchangeCount).toBe(0);
  });

  it("deduplicates concurrent refreshes into one exchange", async () => {
    // Gate the exchange response so it stays pending while all three
    // connectapi() calls are in flight. This proves genuine dedup rather
    // than a coincidence of caching: three truly *sequential* calls would
    // also land on exchangeCount === 1 (the 2nd and 3rd would simply find
    // the token already fresh), so that alone isn't proof of concurrency.
    let releaseExchange: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseExchange = resolve;
    });
    let inFlightExchangeRequests = 0;
    server.use(
      http.post(
        "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0",
        async () => {
          inFlightExchangeRequests++;
          exchangeCount++;
          await gate;
          return HttpResponse.json({
            scope: "CONNECT_READ",
            jti: "j2",
            token_type: "Bearer",
            access_token: "fresh-access",
            refresh_token: "rt2",
            expires_in: 3600,
            refresh_token_expires_in: 7200,
          });
        },
      ),
    );

    const client = new GarminClient();
    client.setTokens(tokensWith(past));

    const results = Promise.all([
      client.connectapi("/thing"),
      client.connectapi("/thing"),
      client.connectapi("/thing"),
    ]);

    // Let the microtask/macrotask queue drain so all three connectapi()
    // calls have started and reached the gated exchange request.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(inFlightExchangeRequests).toBe(1);
    releaseExchange();
    await results;

    expect(exchangeCount).toBe(1);
    // Every waiter must observe the freshly persisted token, not a stale
    // copy captured before the refresh completed.
    expect(seenAuth).toEqual(["Bearer fresh-access", "Bearer fresh-access", "Bearer fresh-access"]);
  });

  it("returns null on 204", async () => {
    const client = new GarminClient();
    client.setTokens(tokensWith(future));
    await expect(client.connectapi("/empty")).resolves.toBeNull();
  });

  it("download returns a Buffer", async () => {
    const client = new GarminClient();
    client.setTokens(tokensWith(future));
    const buf = await client.download("/file");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect([...buf]).toEqual([1, 2, 3]);
  });

  it("upload posts multipart with the filename", async () => {
    const client = new GarminClient();
    client.setTokens(tokensWith(future));
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])]);
    await expect(client.upload(blob, "ride.fit")).resolves.toEqual({
      name: "ride.fit",
      size: 4,
    });
  });

  it("throws GarminAuthError when the API rejects auth", async () => {
    const store = new MemoryTokenStore();
    await store.save(tokensWith(future));
    const client = new GarminClient({ tokenStore: store });
    await client.loadTokens();
    await expect(client.connectapi("/forbidden")).rejects.toThrow(GarminAuthError);

    // An ordinary API-level 401 must NOT log the whole client out: only a
    // dead refresh token (or a failed refresh) clears the store.
    await expect(store.load()).resolves.not.toBeNull();
    expect(client.getTokens()).not.toBeNull();
  });

  it("preserves stored tokens when a refresh fails with a transient network error", async () => {
    server.use(
      http.post(
        "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0",
        () => HttpResponse.error(),
      ),
    );
    const store = new MemoryTokenStore();
    await store.save(tokensWith(past));
    const client = new GarminClient({ tokenStore: store, retries: 0 });
    await client.loadTokens();

    await expect(client.connectapi("/thing")).rejects.toThrow();

    // A DNS blip / timeout during refresh must not destroy a perfectly
    // valid refresh token — the caller should be able to retry later.
    await expect(store.load()).resolves.not.toBeNull();
    expect(client.getTokens()).not.toBeNull();
  });

  it("clears stored tokens when a refresh fails with an auth error", async () => {
    server.use(
      http.post(
        "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0",
        () => new HttpResponse("nope", { status: 401 }),
      ),
    );
    const store = new MemoryTokenStore();
    await store.save(tokensWith(past));
    const client = new GarminClient({ tokenStore: store });
    await client.loadTokens();

    await expect(client.connectapi("/thing")).rejects.toThrow(GarminAuthError);

    await expect(store.load()).resolves.toBeNull();
    expect(client.getTokens()).toBeNull();
  });

  it("does not wedge after a failed refresh: the next call retries cleanly", async () => {
    let exchangeAttempts = 0;
    server.use(
      http.post(
        "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0",
        () => {
          exchangeAttempts++;
          return new HttpResponse("boom", { status: 500 });
        },
      ),
    );
    const client = new GarminClient({ retries: 0 });
    client.setTokens(tokensWith(past));

    await expect(client.connectapi("/thing")).rejects.toThrow();
    expect(exchangeAttempts).toBe(1);

    // If the failed refresh's `finally` didn't reset the cached promise,
    // this second call would either hang or re-serve the same rejection
    // without trying again. It must instead attempt a fresh exchange — and,
    // per the fix above, the tokens were preserved (not cleared) by the
    // first 500, so this call still has credentials to refresh with.
    await expect(client.connectapi("/thing")).rejects.toThrow();
    expect(exchangeAttempts).toBe(2);
  });

  it("clears tokens and throws without attempting an exchange when the refresh token itself is expired", async () => {
    const store = new MemoryTokenStore();
    await store.save(tokensWithExpiredRefresh());
    const client = new GarminClient({ tokenStore: store });
    await client.loadTokens();

    await expect(client.connectapi("/thing")).rejects.toThrow(GarminAuthError);

    expect(exchangeCount).toBe(0);
    await expect(store.load()).resolves.toBeNull();
    expect(client.getTokens()).toBeNull();
  });

  it("does not let caller-supplied headers override the bearer token", async () => {
    const client = new GarminClient();
    client.setTokens(tokensWith(future));
    await client.connectapi("/thing", { headers: { authorization: "Bearer hijacked" } });
    expect(seenAuth[0]).toBe("Bearer old-access");
  });

  it("wraps a non-JSON 200 response in GarminError instead of a bare SyntaxError", async () => {
    server.use(
      http.get(
        "https://connectapi.garmin.com/thing",
        () =>
          new HttpResponse("<html>not json</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ),
    );
    const client = new GarminClient();
    client.setTokens(tokensWith(future));
    await expect(client.connectapi("/thing")).rejects.toThrow(GarminError);
  });

  it("uses the garmin.cn domain when isCn is set", async () => {
    const fetchImpl = vi.fn(
      async (..._args: Parameters<typeof fetch>) =>
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const client = new GarminClient({ isCn: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    client.setTokens(tokensWith(future));
    await client.connectapi("/thing");
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("https://connectapi.garmin.cn/thing");
  });
});
