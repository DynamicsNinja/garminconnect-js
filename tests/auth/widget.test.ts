import { afterEach, describe, expect, it, vi } from "vitest";
import { Fetcher } from "../../src/http/fetcher.js";
import { login } from "../../src/auth/sso.js";
import { resetConsumerCache } from "../../src/auth/consumer.js";
import {
  GarminAuthError,
  GarminConnectionError,
  GarminRateLimitError,
} from "../../src/errors.js";
import { makeSsoServer, type SsoScenario } from "../helpers/sso-server.js";

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
    await login("a@b.test", "super-secret-pw", ctx());
    const post = h.requests.find((r) => r.step === "widget-signin")!;
    expect(post.contentType).toContain("application/x-www-form-urlencoded");
    const form = new URLSearchParams(post.text);
    expect(form.get("username")).toBe("a@b.test");
    expect(form.get("password")).toBe("super-secret-pw");
    expect(form.get("embed")).toBe("true");
    expect(form.get("_csrf")).toBe("csrf-1");
    expect(post.cookie).toContain("WIDGET_SESSION=w1");
    expect(post.referer).toContain("https://sso.garmin.com/sso/signin");
    expect(post.url).not.toContain("super-secret-pw");
    const url = new URL(post.url);
    expect(url.searchParams.get("service")).toBe("https://sso.garmin.com/sso/embed");
    expect(url.searchParams.get("id")).toBe("gauth-widget");
  });

  // MSW simulates a browser-wide cookie jar: it remembers every mocked Set-Cookie and
  // re-injects it into every later same-origin request regardless of which Fetcher/CookieJar
  // instance issued it. That makes the mobile SESSION cookie appear on the widget's requests
  // in this test harness no matter what login() does, even though real `fetch()` never shares
  // cookies across Fetcher instances (see tests/http/fetcher.test.ts "withFreshJar"). So this
  // asserts the real, controllable guarantee instead: login() hands the widget flow a fetcher
  // whose jar starts empty.
  it("gives the widget a fresh cookie jar, not the mobile fetcher's", async () => {
    serve({ loginOutcome: "rate_limited" });
    const c = ctx();
    const spy = vi.spyOn(c.fetcher, "withFreshJar");
    await login("a@b.test", "pw", c);
    expect(spy).toHaveBeenCalledTimes(1);
    const widgetFetcher = spy.mock.results[0]?.value as Fetcher;
    expect(widgetFetcher).not.toBe(c.fetcher);
    // The widget's own jar picks up its own session cookies along the way, but never the
    // mobile fetcher's SESSION cookie: this jar started empty and never saw that response.
    expect(widgetFetcher.jar.cookieHeaderFor("https://sso.garmin.com/sso/embed") ?? "").not.toContain(
      "SESSION=seed",
    );
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
