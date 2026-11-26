import { afterEach, describe, expect, it, vi } from "vitest";
import { GarminClient } from "../../src/client.js";
import { GarminAuthError, GarminDiveAuthError } from "../../src/errors.js";
import { MemoryTokenStore } from "../../src/auth/token-store.js";
import type { Tokens } from "../../src/auth/tokens.js";
import { resetConsumerCache } from "../../src/auth/consumer.js";

function tokens(access = "connect", isCn = false): Tokens {
  const future = Math.floor(Date.now() / 1000) + 7200;
  return {
    oauth1: { oauth_token: `one-${access}`, oauth_token_secret: "secret", domain: isCn ? "garmin.cn" : "garmin.com" },
    oauth2: { access_token: access, token_type: "Bearer", scope: "CONNECT_READ DIVE_API_READ GOLF_API_WRITE",
      jti: "j", refresh_token: "refresh", expires_in: 7200, refresh_token_expires_in: 7200,
      expires_at: future, refresh_token_expires_at: future },
  };
}
function diveToken() {
  return { ...tokens().oauth2, access_token: "dive", scope: "DIVE_API_READ DIVE_API_WRITE", expires_in: 120 };
}
function setup(isCn = false) {
  const exchange = vi.fn(async () => Response.json(diveToken()));
  const fetchImpl = vi.fn<typeof fetch>(async (url) => {
    if (String(url).includes("/di-oauth2-service/")) return exchange();
    return Response.json({ ok: true });
  });
  const tokenStore = new MemoryTokenStore();
  const client = new GarminClient({ isCn, fetchImpl, tokenStore, retries: 0 });
  client.setTokens(tokens("connect", isCn));
  return { client, fetchImpl, exchange, tokenStore };
}
const auth = (init: RequestInit | undefined) => new Headers(init?.headers).get("authorization");
afterEach(() => vi.restoreAllMocks());

describe("Dive write authentication", () => {
  it.each([401, 403])("isolates exchange authentication failure %s from Connect", async (status) => {
    const { client, exchange } = setup();
    exchange.mockResolvedValueOnce(new Response("", { status }));
    await expect(client.connectapi("/diving/v1/dive", { method: "POST" })).rejects.toBeInstanceOf(GarminDiveAuthError);
    await expect(client.connectapi("/userprofile-service/socialProfile")).resolves.toEqual({ ok: true });
  });

  it.each([401, 403])("isolates rejected Dive API and upload credentials (%s)", async (status) => {
    const { client, fetchImpl } = setup();
    await client.refreshTokens({ includeDive: true });
    fetchImpl.mockResolvedValueOnce(new Response("", { status }));
    await expect(client.connectapi("/diving/v1/dive", { method: "POST" })).rejects.toBeInstanceOf(GarminDiveAuthError);
    fetchImpl.mockResolvedValueOnce(new Response("", { status }));
    await expect(client.upload(new Blob(["x"]), "x.png", "/diving/proxy/media/v2/images")).rejects.toBeInstanceOf(GarminDiveAuthError);
    fetchImpl.mockResolvedValueOnce(new Response("", { status }));
    const failure = await client.connectapi("/userprofile-service/socialProfile").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GarminAuthError);
    expect(failure).not.toBeInstanceOf(GarminDiveAuthError);
  });

  it.each([
    { access_token: "" },
    { token_type: "" },
    { scope: "DIVE_API_READ" },
    { expires_at: NaN },
  ])("replaces malformed cached Dive credentials: %j", async (invalid) => {
    const { client, exchange } = setup();
    client.setTokens({ ...tokens(), dive: { ...diveToken(), ...invalid } });
    await client.connectapi("/diving/v1/dive/1", { method: "DELETE" });
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(client.getTokens()?.dive?.access_token).toBe("dive");
  });

  it.each([false, true])("exchanges only for Dive writes, on the regional host (China: %s)", async (isCn) => {
    const { client, fetchImpl, tokenStore } = setup(isCn);
    const original = client.getTokens();
    await client.connectapi("/diving/v1/dive/tags");
    await client.connectapi("/diving/v1/dive", { method: "post", json: {} });
    await client.connectapi("/activity-service/activity/1", { method: "PUT", json: {} });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(String(url)).toBe(`https://connectapi.${isCn ? "garmin.cn" : "garmin.com"}/di-oauth2-service/oauth/token`);
    expect(init?.method).toBe("POST");
    expect(auth(init)).toBe(`Basic ${Buffer.from("DIVE_MOBILE_ANDROID_DI:").toString("base64")}`);
    expect(new URLSearchParams(String(init?.body))).toEqual(new URLSearchParams({
      client_id: "DIVE_MOBILE_ANDROID_DI", subject_token: "connect",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    }));
    expect(auth(fetchImpl.mock.calls[0]?.[1])).toBe("Bearer connect");
    expect(auth(fetchImpl.mock.calls[2]?.[1])).toBe("Bearer dive");
    expect(auth(fetchImpl.mock.calls[3]?.[1])).toBe("Bearer connect");
    expect(client.getTokens()?.oauth1).toBe(original?.oauth1);
    expect(client.getTokens()?.oauth2).toBe(original?.oauth2);
    expect((await tokenStore.load())?.dive?.access_token).toBe("dive");
  });

  it("coalesces concurrent exchanges and reuses the cached token", async () => {
    const { client, fetchImpl, exchange } = setup();
    await Promise.all(["POST", "PATCH", "DELETE", "PUT"].map((method) =>
      client.connectapi("/diving/v1/gear/1", { method, headers: { Authorization: "attacker" } })));
    await client.connectapi("/diving/v1/gear/2", { method: "DELETE" });
    expect(exchange).toHaveBeenCalledTimes(1);
    for (const [, init] of fetchImpl.mock.calls.filter(([url]) => String(url).includes("/diving/"))) {
      expect(auth(init)).toBe("Bearer dive");
    }
  });

  it("reuses persisted Dive credentials in a new client without another exchange", async () => {
    const { client, fetchImpl, exchange, tokenStore } = setup();
    await client.connectapi("/diving/v1/dive/1", { method: "DELETE" });
    const next = new GarminClient({ fetchImpl, tokenStore, retries: 0 });
    expect(await next.loadTokens()).toBe(true);
    await next.connectapi("/diving/v1/dive/2", { method: "DELETE" });
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(auth(fetchImpl.mock.calls.at(-1)?.[1])).toBe("Bearer dive");
    expect(next.getTokens()?.oauth2.access_token).toBe("connect");
  });

  it("prepares serializable Dive credentials without dispatching a write", async () => {
    const { client, exchange, fetchImpl } = setup();
    const saved = JSON.parse(JSON.stringify(await client.refreshTokens({ includeDive: true }))) as Tokens;
    const next = new GarminClient({ fetchImpl, retries: 0 });
    next.setTokens(saved);
    await next.connectapi("/diving/v1/dive/1", { method: "DELETE" });
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("renews Dive credentials within the caller's requested margin", async () => {
    const { client, exchange } = setup();
    await client.refreshTokens({ includeDive: true });
    await client.refreshTokens({ includeDive: true, withinMs: 180_000 });
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it("does not write or cache a token when persistence fails", async () => {
    const { client, exchange, fetchImpl, tokenStore } = setup();
    vi.spyOn(tokenStore, "save").mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(client.connectapi("/diving/v1/dive", { method: "POST" })).rejects.toThrow("storage unavailable");
    expect(client.getTokens()?.dive).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await client.connectapi("/diving/v1/dive", { method: "POST" });
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it("uses the Dive token for multipart uploads without trusting caller authorization", async () => {
    const { client, fetchImpl } = setup();
    await client.upload(new Blob(["fixture"]), "fixture.png", "/diving/proxy/media/v2/images", {
      headers: { Authorization: "attacker", "User-Agent": "custom" },
    });
    const init = fetchImpl.mock.calls[1]?.[1];
    expect(auth(init)).toBe("Bearer dive");
    expect(init?.body).toBeInstanceOf(FormData);
    expect(new Headers(init?.headers).has("content-type")).toBe(false);
    expect(new Headers(init?.headers).get("user-agent")).toBe("custom");
  });

  it("re-exchanges before Dive expiry rather than refreshing through the Connect identity", async () => {
    const { client, exchange } = setup();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    await client.connectapi("/diving/v1/dive/1", { method: "DELETE" });
    clock.mockReturnValue(now + 61000);
    await client.connectapi("/diving/v1/dive/2", { method: "DELETE" });
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it("forwards the optional MFA token", async () => {
    const { client, fetchImpl } = setup();
    const source = tokens();
    source.oauth1.mfa_token = "mfa-fixture";
    client.setTokens(source);
    await client.connectapi("/diving/v1/dive", { method: "POST" });
    expect(new URLSearchParams(String(fetchImpl.mock.calls[0]?.[1]?.body)).get("mfa_token")).toBe("mfa-fixture");
  });

  it("discards cached Dive credentials when switching accounts or reloading tokens", async () => {
    const { client, exchange, tokenStore, fetchImpl } = setup();
    await client.connectapi("/diving/v1/dive/1", { method: "DELETE" });
    client.setTokens(tokens("other-account"));
    await client.connectapi("/diving/v1/dive/1", { method: "DELETE" });
    await tokenStore.save(tokens("loaded-account"));
    await client.loadTokens();
    await client.connectapi("/diving/v1/dive/1", { method: "DELETE" });
    expect(exchange).toHaveBeenCalledTimes(3);
    const subjects = fetchImpl.mock.calls.filter(([url]) => String(url).includes("/di-oauth2-service/"))
      .map(([, init]) => new URLSearchParams(String(init?.body)).get("subject_token"));
    expect(subjects).toEqual(["connect", "other-account", "loaded-account"]);
    expect((await tokenStore.load())?.oauth2.access_token).toBe("loaded-account");
  });

  it("does not dispatch a stale write when authentication changes during an exchange", async () => {
    const { client, exchange, fetchImpl } = setup();
    exchange.mockImplementationOnce(async () => {
      client.setTokens(tokens("different-account"));
      return Response.json(diveToken());
    });
    await expect(client.connectapi("/diving/v1/dive", { method: "POST" })).rejects.toThrow("Authentication changed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await client.connectapi("/diving/v1/dive", { method: "POST" });
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it("clears failed in-flight exchanges and leaves normal credentials usable", async () => {
    const { client, exchange, fetchImpl } = setup();
    exchange.mockResolvedValueOnce(new Response("Denied", { status: 403 }));
    await expect(client.connectapi("/diving/v1/dive", { method: "POST" })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await client.connectapi("/activitylist-service/activities/search/activities");
    await client.connectapi("/diving/v1/dive", { method: "POST" });
    expect(exchange).toHaveBeenCalledTimes(2);
    expect(client.getTokens()?.oauth2.access_token).toBe("connect");
  });

  it("refuses malformed or insufficient tokens before any write", async () => {
    for (const raw of [
      null,
      { ...diveToken(), scope: "DIVE_API_READ" },
      { ...diveToken(), access_token: "" },
      { ...diveToken(), token_type: null },
      { ...diveToken(), expires_in: 1 },
      { ...diveToken(), expires_in: "7200" },
    ]) {
      const { client, exchange, fetchImpl } = setup();
      exchange.mockResolvedValueOnce(Response.json(raw));
      await expect(client.connectapi("/diving/v1/dive", { method: "POST" })).rejects.toThrow("DIVE_API_WRITE");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("handles HTML token responses without exposing the body", async () => {
    const { client, exchange } = setup();
    exchange.mockResolvedValueOnce(new Response("<html>sensitive challenge</html>"));
    await expect(client.connectapi("/diving/v1/dive", { method: "POST" })).rejects.toThrow("non-JSON");
  });

  it("does not replay a failed token-exchange POST", async () => {
    const { client, exchange, fetchImpl } = setup();
    exchange.mockResolvedValue(new Response("temporary", { status: 503 }));
    await expect(client.connectapi("/diving/v1/dive", { method: "POST" })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refreshes an expired Connect token before the Dive exchange", async () => {
    resetConsumerCache();
    const source = tokens();
    source.oauth2.expires_at = 1;
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes("oauth_consumer")) return Response.json({ consumer_key: "key", consumer_secret: "secret" });
      if (String(url).includes("/oauth/exchange/")) return Response.json({ ...tokens().oauth2, access_token: "fresh-connect" });
      if (String(url).includes("/di-oauth2-service/")) return Response.json(diveToken());
      return Response.json({});
    });
    const tokenStore = new MemoryTokenStore();
    const client = new GarminClient({ fetchImpl, tokenStore });
    client.setTokens(source);
    await client.connectapi("/diving/v1/dive", { method: "POST" });
    expect(new URLSearchParams(String(fetchImpl.mock.calls[2]?.[1]?.body)).get("subject_token")).toBe("fresh-connect");
    expect((await tokenStore.load())?.oauth2.access_token).toBe("fresh-connect");
    expect((await tokenStore.load())?.dive?.access_token).toBe("dive");
    resetConsumerCache();
  });

  it("preserves an unexpired Dive token across normal Connect refresh", async () => {
    resetConsumerCache();
    const source = tokens();
    source.oauth2.expires_at = 1;
    source.dive = diveToken();
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes("oauth_consumer")) return Response.json({ consumer_key: "key", consumer_secret: "secret" });
      if (String(url).includes("/oauth/exchange/")) return Response.json({ ...tokens().oauth2, access_token: "fresh-connect" });
      throw new Error("Unexpected exchange or write");
    });
    const client = new GarminClient({ fetchImpl, retries: 0 });
    client.setTokens(source);
    const refreshed = await client.refreshTokens({ includeDive: true });
    expect(refreshed.dive).toEqual(source.dive);
    expect(refreshed.oauth2.access_token).toBe("fresh-connect");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    resetConsumerCache();
  });
});
