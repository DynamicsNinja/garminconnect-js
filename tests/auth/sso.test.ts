import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Fetcher } from "../../src/http/fetcher.js";
import { exchange, login } from "../../src/auth/sso.js";
import { resetConsumerCache } from "../../src/auth/consumer.js";
import { GarminAuthError } from "../../src/errors.js";
import { makeSsoServer } from "../helpers/sso-server.js";
import type { OAuth1Token } from "../../src/auth/tokens.js";

describe("login — success path", () => {
  let harness: ReturnType<typeof makeSsoServer>;

  beforeEach(() => {
    resetConsumerCache();
    harness = makeSsoServer({ loginOutcome: "success" });
    harness.server.listen({ onUnhandledRequest: "error" });
  });
  afterEach(() => harness.server.close());

  it("returns both tokens", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    const result = await login("a@b.test", "pw", ctx);
    expect(result.state).toBe("success");
    if (result.state !== "success") throw new Error("unreachable");
    expect(result.oauth1.oauth_token).toBe("o1tok");
    expect(result.oauth1.oauth_token_secret).toBe("o1sec");
    expect(result.oauth1.mfa_token).toBe("mfatok");
    expect(result.oauth1.domain).toBe("garmin.com");
    expect(result.oauth2.access_token).toBe("access-1");
    expect(result.oauth2.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("walks the flow in order", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    await login("a@b.test", "pw", ctx);
    expect(harness.calls).toEqual([
      "sign-in",
      "login",
      "embed",
      "consumer",
      "preauthorized",
      "exchange",
    ]);
  });
});

describe("login — rejection", () => {
  let harness: ReturnType<typeof makeSsoServer>;

  beforeEach(() => {
    resetConsumerCache();
    harness = makeSsoServer({ loginOutcome: "bad_credentials" });
    harness.server.listen({ onUnhandledRequest: "error" });
  });
  afterEach(() => harness.server.close());

  it("throws GarminAuthError carrying the Garmin message", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    await expect(login("a@b.test", "wrong", ctx)).rejects.toThrow(GarminAuthError);
    await expect(login("a@b.test", "wrong", ctx)).rejects.toThrow(
      /INVALID_USERNAME_PASSWORD: Bad creds/,
    );
  });
});

describe("exchange — audience and mfa_token forwarding (5a)", () => {
  let harness: ReturnType<typeof makeSsoServer>;

  beforeEach(() => {
    resetConsumerCache();
    harness = makeSsoServer({ loginOutcome: "success" });
    harness.server.listen({ onUnhandledRequest: "error" });
  });
  afterEach(() => harness.server.close());

  it("includes audience on a full login()", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    await login("a@b.test", "pw", ctx);
    const exchangeReq = harness.requests.find((r) => r.step === "exchange");
    expect(exchangeReq?.text).toContain("audience=GARMIN_CONNECT_MOBILE_ANDROID_DI");
    // The fixture's oauth1 token carries mfa_token=mfatok, forwarded too.
    expect(exchangeReq?.text).toContain("mfa_token=mfatok");
  });

  it("omits audience when exchange() is called directly with no opts (refresh path)", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    const oauth1: OAuth1Token = {
      oauth_token: "o1tok",
      oauth_token_secret: "o1sec",
      domain: "garmin.com",
    };
    await exchange(oauth1, ctx);
    const exchangeReq = harness.requests.find((r) => r.step === "exchange");
    expect(exchangeReq?.text).not.toContain("audience");
    expect(exchangeReq?.text).not.toContain("mfa_token");
  });
});

describe("OAuth1 header shape at each signing step (5b)", () => {
  let harness: ReturnType<typeof makeSsoServer>;

  beforeEach(() => {
    resetConsumerCache();
    harness = makeSsoServer({ loginOutcome: "success" });
    harness.server.listen({ onUnhandledRequest: "error" });
  });
  afterEach(() => harness.server.close());

  it("signs preauthorized with the consumer key and no token", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    await login("a@b.test", "pw", ctx);
    const preauth = harness.requests.find((r) => r.step === "preauthorized");
    expect(preauth?.authorization).toContain('oauth_consumer_key="ck"');
    expect(preauth?.authorization).not.toMatch(/oauth_token=/);
  });

  it("signs exchange with the consumer key and the oauth1 token", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    await login("a@b.test", "pw", ctx);
    const ex = harness.requests.find((r) => r.step === "exchange");
    expect(ex?.authorization).toContain('oauth_consumer_key="ck"');
    expect(ex?.authorization).toContain('oauth_token="o1tok"');
  });
});

describe("step-2 credential submission shape (5c)", () => {
  let harness: ReturnType<typeof makeSsoServer>;

  beforeEach(() => {
    resetConsumerCache();
    harness = makeSsoServer({ loginOutcome: "success" });
    harness.server.listen({ onUnhandledRequest: "error" });
  });
  afterEach(() => harness.server.close());

  it("sends the expected JSON body fields and query params, and never puts the password in the URL", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    await login("a@b.test", "super-secret-pw", ctx);
    const loginReq = harness.requests.find((r) => r.step === "login");
    expect(loginReq).toBeDefined();

    const json = loginReq?.json as {
      username: string;
      password: string;
      rememberMe: boolean;
      captchaToken: string;
    };
    expect(json).toMatchObject({
      username: "a@b.test",
      password: "super-secret-pw",
      rememberMe: false,
      captchaToken: "",
    });

    const url = new URL(loginReq!.url);
    expect(url.searchParams.get("clientId")).toBe("GCM_ANDROID_DARK");
    expect(url.searchParams.has("locale")).toBe(true);
    expect(url.searchParams.has("service")).toBe(true);

    expect(loginReq!.url).not.toContain("super-secret-pw");
  });
});

describe("MFA branch state (5d)", () => {
  let harness: ReturnType<typeof makeSsoServer>;

  beforeEach(() => {
    resetConsumerCache();
    harness = makeSsoServer({ loginOutcome: "mfa" });
    harness.server.listen({ onUnhandledRequest: "error" });
  });
  afterEach(() => harness.server.close());

  it("returns a serializable mfaState that carries no credentials", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    const result = await login("secret@b.test", "super-secret-pw", ctx);
    expect(result.state).toBe("mfa_required");
    if (result.state !== "mfa_required") throw new Error("unreachable");

    expect(result.mfaState.mfaMethod).toBe("sms");
    expect(result.mfaState.domain).toBe("garmin.com");
    expect(Array.isArray(result.mfaState.cookies)).toBe(true);
    expect(result.mfaState.loginParams).toMatchObject({
      clientId: "GCM_ANDROID_DARK",
      locale: "en-US",
      service: "https://mobile.integration.garmin.com/gcm/android",
    });

    const serialized = JSON.stringify(result.mfaState);
    expect(serialized).not.toContain("super-secret-pw");
    expect(serialized).not.toContain("secret@b.test");

    const roundTripped = JSON.parse(serialized) as unknown;
    expect(roundTripped).toEqual(result.mfaState);
  });
});

describe("negative parse paths (5e)", () => {
  // Each `it` below owns its own harness/listen/close since the scenario differs per case.

  it("throws GarminAuthError when SUCCESSFUL carries no serviceTicketId", async () => {
    resetConsumerCache();
    const harness = makeSsoServer({ loginOutcome: "successful_no_ticket" });
    harness.server.listen({ onUnhandledRequest: "error" });
    try {
      const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
      await expect(login("a@b.test", "pw", ctx)).rejects.toThrow(GarminAuthError);
      await expect(login("a@b.test", "pw", ctx)).rejects.toThrow(
        "SSO succeeded but returned no service ticket",
      );
    } finally {
      harness.server.close();
    }
  });

  it("throws GarminAuthError when the response has no responseStatus at all", async () => {
    resetConsumerCache();
    const harness = makeSsoServer({ loginOutcome: "no_response_status" });
    harness.server.listen({ onUnhandledRequest: "error" });
    try {
      const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
      await expect(login("a@b.test", "pw", ctx)).rejects.toThrow(GarminAuthError);
      await expect(login("a@b.test", "pw", ctx)).rejects.toThrow("SSO error: UNKNOWN");
    } finally {
      harness.server.close();
    }
  });

  it("throws GarminAuthError when the oauth1 form body has oauth_token but no oauth_token_secret", async () => {
    resetConsumerCache();
    const harness = makeSsoServer({
      loginOutcome: "success",
      oauth1Body: "oauth_token=o1tok",
    });
    harness.server.listen({ onUnhandledRequest: "error" });
    try {
      const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
      await expect(login("a@b.test", "pw", ctx)).rejects.toThrow(GarminAuthError);
      await expect(login("a@b.test", "pw", ctx)).rejects.toThrow(
        "OAuth1 exchange returned no token",
      );
    } finally {
      harness.server.close();
    }
  });

  it("throws GarminAuthError when the oauth1 step returns a Cloudflare HTML challenge body", async () => {
    resetConsumerCache();
    const harness = makeSsoServer({
      loginOutcome: "success",
      oauth1Body: "<html><body>Attention Required</body></html>",
    });
    harness.server.listen({ onUnhandledRequest: "error" });
    try {
      const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
      await expect(login("a@b.test", "pw", ctx)).rejects.toThrow(GarminAuthError);
      await expect(login("a@b.test", "pw", ctx)).rejects.toThrow(
        "OAuth1 exchange returned no token",
      );
    } finally {
      harness.server.close();
    }
  });
});
