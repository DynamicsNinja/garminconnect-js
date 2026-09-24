import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Fetcher } from "../../src/http/fetcher.js";
import { login, resumeLogin } from "../../src/auth/sso.js";
import { resetConsumerCache } from "../../src/auth/consumer.js";
import { GarminAuthError } from "../../src/errors.js";
import { makeSsoServer } from "../helpers/sso-server.js";

describe("MFA login", () => {
  let harness: ReturnType<typeof makeSsoServer>;

  beforeEach(() => {
    resetConsumerCache();
    harness = makeSsoServer({ loginOutcome: "mfa", mfaCode: "123456" });
    harness.server.listen({ onUnhandledRequest: "error" });
  });
  afterEach(() => harness.server.close());

  it("returns mfa_required with the method Garmin reported", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    const result = await login("a@b.test", "pw", ctx);
    expect(result.state).toBe("mfa_required");
    if (result.state !== "mfa_required") throw new Error("unreachable");
    expect(result.mfaState.mfaMethod).toBe("sms");
    expect(result.mfaState.domain).toBe("garmin.com");
    if (result.mfaState.flow === "widget") throw new Error("expected a mobile state");
    expect(result.mfaState.loginParams.clientId).toBe("GCM_ANDROID_DARK");
  });

  it("mfaState survives JSON round-trip and carries the session cookies", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    const result = await login("a@b.test", "pw", ctx);
    if (result.state !== "mfa_required") throw new Error("unreachable");

    const revived = JSON.parse(JSON.stringify(result.mfaState));
    expect(revived.cookies.some((c: { name: string }) => c.name === "SESSION")).toBe(true);
  });

  it("resumes in a FRESH client — the serverless case — and returns tokens", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    const result = await login("a@b.test", "pw", ctx);
    if (result.state !== "mfa_required") throw new Error("unreachable");

    // Simulate a second HTTP request on a different instance: nothing but JSON survives.
    const transported = JSON.parse(JSON.stringify(result.mfaState));
    const resumed = await resumeLogin(transported, "123456");

    expect(resumed.state).toBe("success");
    expect(resumed.oauth1.oauth_token).toBe("o1tok");
    expect(resumed.oauth2.access_token).toBe("access-1");
  });

  it("replays the stored cookies on the verifyCode request", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    const result = await login("a@b.test", "pw", ctx);
    if (result.state !== "mfa_required") throw new Error("unreachable");

    const fresh = new Fetcher();
    await resumeLogin(JSON.parse(JSON.stringify(result.mfaState)), "123456", {
      fetcher: fresh,
    });
    expect(fresh.jar.cookieHeaderFor("https://sso.garmin.com/sso/x")).toContain("SESSION=seed");
  });

  it(
    "preserves a Domain-scoped cookie's scope when resuming with a caller-supplied fetcher " +
      "(regression: replaying via setFromResponse would host-lock it and drop connectapi access)",
    async () => {
      const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
      const result = await login("a@b.test", "pw", ctx);
      if (result.state !== "mfa_required") throw new Error("unreachable");

      // Simulate a cookie that was scoped with `Domain=.garmin.com` at login
      // time (hostOnly: false), the transport-JSON shape it would arrive as.
      const transported = JSON.parse(JSON.stringify(result.mfaState));
      transported.cookies.push({
        name: "GARMIN_SSO_GUID",
        value: "abc123",
        domain: "garmin.com",
        path: "/",
        secure: true,
        hostOnly: false,
      });

      const fresh = new Fetcher();
      await resumeLogin(transported, "123456", { fetcher: fresh });

      expect(fresh.jar.cookieHeaderFor("https://connectapi.garmin.com/x")).toContain(
        "GARMIN_SSO_GUID=abc123",
      );
    },
  );

  it("rejects a wrong code with GarminAuthError", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    const result = await login("a@b.test", "pw", ctx);
    if (result.state !== "mfa_required") throw new Error("unreachable");

    await expect(resumeLogin(result.mfaState, "000000")).rejects.toThrow(GarminAuthError);
    await expect(resumeLogin(result.mfaState, "000000")).rejects.toThrow(/Wrong code/);
  });

  it("mfaState carries no password", async () => {
    const ctx = { fetcher: new Fetcher(), domain: "garmin.com" };
    const result = await login("a@b.test", "hunter2", ctx);
    if (result.state !== "mfa_required") throw new Error("unreachable");
    expect(JSON.stringify(result.mfaState)).not.toContain("hunter2");
  });
});
