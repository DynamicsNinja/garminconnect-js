import { afterEach, describe, expect, it } from "vitest";
import { Fetcher } from "../../src/http/fetcher.js";
import { login } from "../../src/auth/sso.js";
import { resetConsumerCache } from "../../src/auth/consumer.js";
import {
  GarminAuthError,
  GarminConnectionError,
  GarminRateLimitError,
} from "../../src/errors.js";
import { makeSsoServer, recordingFetch, type SsoScenario } from "../helpers/sso-server.js";

let harness: ReturnType<typeof makeSsoServer> | undefined;

function serve(scenario: SsoScenario) {
  resetConsumerCache();
  harness = makeSsoServer(scenario);
  harness.server.listen({ onUnhandledRequest: "error" });
  return harness;
}

afterEach(() => {
  harness?.server.close();
  harness = undefined;
});

const ctx = () => ({ fetcher: new Fetcher(), domain: "garmin.com", loginDelayMs: 0 });
const ctxWithFetch = (fetchImpl: typeof fetch) => ({
  fetcher: new Fetcher({ fetchImpl }),
  domain: "garmin.com",
  loginDelayMs: 0,
});
const WIDGET_STEPS = ["widget-embed", "widget-signin-page", "widget-signin"];

describe("fallback to the SSO widget", () => {
  it.each(["rate_limited", "rate_limited_json"] as const)(
    "signs in through the widget when the mobile login answers %s",
    async (loginOutcome) => {
      const h = serve({ loginOutcome });
      const result = await login("a@b.test", "pw", ctx());
      expect(result.state).toBe("success");
      if (result.state !== "success") throw new Error("unreachable");
      expect(result.oauth1.oauth_token).toBe("o1tok");
      expect(result.oauth2.access_token).toBe("access-1");
      expect(h.calls).toEqual([
        "sign-in",
        "login",
        ...WIDGET_STEPS,
        "embed",
        "consumer",
        "preauthorized",
        "exchange",
      ]);
    },
  );

  it("exchanges the widget ticket with the widget's login-url", async () => {
    const h = serve({ loginOutcome: "rate_limited", widgetTicket: "ST-W42" });
    await login("a@b.test", "pw", ctx());
    const preauth = h.requests.find((r) => r.step === "preauthorized");
    const url = new URL(preauth!.url);
    expect(url.searchParams.get("ticket")).toBe("ST-W42");
    expect(url.searchParams.get("login-url")).toBe("https://sso.garmin.com/sso/embed");
  });

  it("posts the form with the page's CSRF token and the embed session cookie, never the password in the URL", async () => {
    const h = serve({ loginOutcome: "rate_limited" });
    const { fetchImpl, sent } = recordingFetch();
    await login("a@b.test", "super-secret-pw", ctxWithFetch(fetchImpl));
    const post = h.requests.find((r) => r.step === "widget-signin")!;
    expect(post.contentType).toContain("application/x-www-form-urlencoded");
    const form = new URLSearchParams(post.text);
    expect(form.get("username")).toBe("a@b.test");
    expect(form.get("password")).toBe("super-secret-pw");
    expect(form.get("embed")).toBe("true");
    expect(form.get("_csrf")).toBe("csrf-1");
    // Asserted against what the library itself sent, not msw's capture: see recordingFetch's
    // doc comment for why msw's own cookie header is not trustworthy here.
    const sentPost = sent.find((s) => new URL(s.url).pathname === "/sso/signin" && s.method === "POST");
    expect(sentPost?.cookie).toContain("WIDGET_SESSION=w1");
    expect(post.referer).toContain("https://sso.garmin.com/sso/signin");
    expect(post.url).not.toContain("super-secret-pw");
    const url = new URL(post.url);
    expect(url.searchParams.get("service")).toBe("https://sso.garmin.com/sso/embed");
    expect(url.searchParams.get("id")).toBe("gauth-widget");
  });

  it("does not send mobile cookies to the widget", async () => {
    serve({ loginOutcome: "rate_limited" });
    const { fetchImpl, sent } = recordingFetch();
    await login("a@b.test", "pw", ctxWithFetch(fetchImpl));
    // Match the widget's own paths exactly: completeLogin's best-effort call to
    // `/portal/sso/embed` (on the ORIGINAL mobile fetcher, by design) also contains the
    // substring "/sso/embed" and must not be mistaken for the widget's `/sso/embed`.
    const widgetRequests = sent.filter((s) => {
      const path = new URL(s.url).pathname;
      return path === "/sso/embed" || path === "/sso/signin";
    });
    expect(widgetRequests.length).toBeGreaterThan(0);
    for (const req of widgetRequests) {
      expect(req.cookie ?? "").not.toContain("SESSION=seed");
    }
    // Proves the widget ran on a jar that DID receive the embed step's own cookie — i.e. a
    // real, working jar, not merely an empty one nothing ever populated.
    const signinPost = sent.find((s) => new URL(s.url).pathname === "/sso/signin" && s.method === "POST");
    expect(signinPost?.cookie).toContain("WIDGET_SESSION=w1");
  });
});

describe("no fallback", () => {
  it("keeps a rejected password on the mobile route", async () => {
    const h = serve({ loginOutcome: "bad_credentials" });
    await expect(login("a@b.test", "wrong", ctx())).rejects.toThrow(/SSO error: INVALID_USERNAME_PASSWORD/);
    expect(h.calls.some((c) => c.startsWith("widget"))).toBe(false);
  });

  it("does not fall back on a rate limit after the password was accepted", async () => {
    const h = serve({ loginOutcome: "success", preauthorizedRateLimited: true });
    await expect(login("a@b.test", "pw", ctx())).rejects.toBeInstanceOf(GarminRateLimitError);
    expect(h.calls.some((c) => c.startsWith("widget"))).toBe(false);
  });
});

describe("widget failures", () => {
  it("reports a rejected password with the SSO error prefix and no password", async () => {
    serve({ loginOutcome: "rate_limited", widgetOutcome: "bad_credentials" });
    const err = await login("a@b.test", "super-secret-pw", ctx()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GarminAuthError);
    expect((err as Error).message).toBe("SSO error: INVALID_CREDENTIALS: Invalid sign in");
    expect((err as Error).message).not.toContain("super-secret-pw");
  });

  it("reports a rate-limited widget with the widget URL", async () => {
    serve({ loginOutcome: "rate_limited", widgetOutcome: "rate_limited" });
    const err = await login("a@b.test", "pw", ctx()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GarminRateLimitError);
    expect((err as Error).message).toContain("https://sso.garmin.com/sso/signin");
  });

  it("fails clearly without a CSRF token", async () => {
    serve({ loginOutcome: "rate_limited", widgetOutcome: "no_csrf" });
    await expect(login("a@b.test", "pw", ctx())).rejects.toThrow(
      new GarminConnectionError("Widget login: missing CSRF token"),
    );
  });

  it("fails clearly on a Success page without a ticket", async () => {
    serve({ loginOutcome: "rate_limited", widgetOutcome: "success_no_ticket" });
    await expect(login("a@b.test", "pw", ctx())).rejects.toThrow(
      new GarminAuthError("Widget login: missing service ticket"),
    );
  });
});
