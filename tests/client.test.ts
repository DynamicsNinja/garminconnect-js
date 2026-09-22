import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../src/client.js";
import { MemoryTokenStore } from "../src/auth/token-store.js";
import { GarminAuthError } from "../src/errors.js";
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
afterEach(() => server.close());

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
    const client = new GarminClient();
    client.setTokens(tokensWith(past));
    await Promise.all([
      client.connectapi("/thing"),
      client.connectapi("/thing"),
      client.connectapi("/thing"),
    ]);
    expect(exchangeCount).toBe(1);
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
