import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Fetcher } from "../../src/http/fetcher.js";
import { login } from "../../src/auth/sso.js";
import { resetConsumerCache } from "../../src/auth/consumer.js";
import { GarminAuthError } from "../../src/errors.js";
import { makeSsoServer } from "../helpers/sso-server.js";

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
