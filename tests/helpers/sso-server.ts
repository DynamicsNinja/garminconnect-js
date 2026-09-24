import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

export interface SsoScenario {
  loginOutcome?:
    | "success"
    | "mfa"
    | "bad_credentials"
    | "successful_no_ticket"
    | "no_response_status"
    | "rate_limited"
    | "rate_limited_json";
  ticket?: string;
  mfaCode?: string;
  /** Overrides the raw form-urlencoded body returned by the preauthorized (oauth1) step. */
  oauth1Body?: string;
  /** The preauthorized (oauth1) step answers 429. */
  preauthorizedRateLimited?: boolean;
  /** What the SSO web widget's credential POST returns. */
  widgetOutcome?:
    | "success"
    | "mfa"
    | "mfa_code_sent"
    | "bad_credentials"
    | "rate_limited"
    | "no_csrf"
    | "success_no_ticket";
  widgetTicket?: string;
}

/** One HTTP request the fake server observed, for asserting on shape. */
export interface CapturedRequest {
  step: string;
  url: string;
  authorization: string | null;
  cookie: string | null;
  referer: string | null;
  contentType: string | null;
  /** Parsed JSON body, when the request had a JSON content-type. */
  json?: unknown;
  /** Raw text body, always captured. */
  text: string;
}

const page = (title: string, body = "") =>
  `<!DOCTYPE html><html><head><title>${title}</title></head><body>${body}</body></html>`;
const csrfInput = (value: string) =>
  `<form><input type="hidden" name="_csrf" value="${value}" /></form>`;
const successPage = (ticket: string) =>
  page(
    "Success",
    `<script>var redirectAfterAccountLoginUrl = "https://sso.garmin.com/sso/embed?ticket=${ticket}";</script>`,
  );
const mfaPage = (codeSentTo: string) =>
  page(
    "GARMIN Authentication Application",
    `<script>var customerGuid = "guid-1"; var mfaMethod = "email"; var locale = "en_US";` +
      ` var clientId = "GarminConnect"; var codeSentTo = "${codeSentTo}";</script>` +
      csrfInput("csrf-mfa"),
  );

export function makeSsoServer(scenario: SsoScenario = {}) {
  const ticket = scenario.ticket ?? "ST-12345";
  const outcome = scenario.loginOutcome ?? "success";
  const widgetTicket = scenario.widgetTicket ?? "ST-W1";
  const widgetOutcome = scenario.widgetOutcome ?? "success";
  const calls: string[] = [];
  const requests: CapturedRequest[] = [];

  async function capture(step: string, request: Request): Promise<CapturedRequest> {
    calls.push(step);
    const text = await request.clone().text();
    let json: unknown;
    if (request.headers.get("content-type")?.includes("json")) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    const captured: CapturedRequest = {
      step,
      url: request.url,
      authorization: request.headers.get("authorization"),
      cookie: request.headers.get("cookie"),
      referer: request.headers.get("referer"),
      contentType: request.headers.get("content-type"),
      json,
      text,
    };
    requests.push(captured);
    return captured;
  }

  const server = setupServer(
    http.get("https://thegarth.s3.amazonaws.com/oauth_consumer.json", async ({ request }) => {
      await capture("consumer", request);
      return HttpResponse.json({ consumer_key: "ck", consumer_secret: "cs" });
    }),

    http.get("https://sso.garmin.com/mobile/sso/en/sign-in", async ({ request }) => {
      await capture("sign-in", request);
      return new HttpResponse("<html></html>", {
        headers: { "set-cookie": "SESSION=seed; Path=/" },
      });
    }),

    http.post("https://sso.garmin.com/mobile/api/login", async ({ request }) => {
      await capture("login", request);
      if (outcome === "rate_limited") {
        return new HttpResponse("Too Many Requests", { status: 429 });
      }
      if (outcome === "rate_limited_json") {
        return HttpResponse.json({ error: { "status-code": "429", message: "Too many requests" } });
      }
      if (outcome === "success") {
        return HttpResponse.json({
          responseStatus: { type: "SUCCESSFUL" },
          serviceTicketId: ticket,
        });
      }
      if (outcome === "mfa") {
        return HttpResponse.json({
          responseStatus: { type: "MFA_REQUIRED" },
          customerMfaInfo: { mfaLastMethodUsed: "sms" },
        });
      }
      if (outcome === "successful_no_ticket") {
        return HttpResponse.json({ responseStatus: { type: "SUCCESSFUL" } });
      }
      if (outcome === "no_response_status") {
        return HttpResponse.json({});
      }
      return HttpResponse.json({
        responseStatus: { type: "INVALID_USERNAME_PASSWORD", message: "Bad creds" },
      });
    }),

    http.post("https://sso.garmin.com/mobile/api/mfa/verifyCode", async ({ request }) => {
      const captured = await capture("mfa", request);
      const body = captured.json as { mfaVerificationCode: string };
      if (scenario.mfaCode && body.mfaVerificationCode !== scenario.mfaCode) {
        return HttpResponse.json({
          responseStatus: { type: "INVALID_MFA_CODE", message: "Wrong code" },
        });
      }
      return HttpResponse.json({
        responseStatus: { type: "SUCCESSFUL" },
        serviceTicketId: ticket,
      });
    }),

    http.get("https://sso.garmin.com/portal/sso/embed", async ({ request }) => {
      await capture("embed", request);
      return new HttpResponse("", { headers: { "set-cookie": "LB=node1; Path=/" } });
    }),

    http.get(
      "https://connectapi.garmin.com/oauth-service/oauth/preauthorized",
      async ({ request }) => {
        const captured = await capture("preauthorized", request);
        if (scenario.preauthorizedRateLimited) {
          return new HttpResponse("Too Many Requests", { status: 429 });
        }
        const auth = captured.authorization ?? "";
        if (!auth.startsWith("OAuth ")) {
          return new HttpResponse("unsigned", { status: 401 });
        }
        return new HttpResponse(
          scenario.oauth1Body ??
            "oauth_token=o1tok&oauth_token_secret=o1sec&mfa_token=mfatok",
          { headers: { "content-type": "application/x-www-form-urlencoded" } },
        );
      },
    ),

    http.post(
      "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0",
      async ({ request }) => {
        const captured = await capture("exchange", request);
        const auth = captured.authorization ?? "";
        if (!auth.includes('oauth_token="o1tok"')) {
          return new HttpResponse("unsigned", { status: 401 });
        }
        return HttpResponse.json({
          scope: "CONNECT_READ",
          jti: "jti-1",
          token_type: "Bearer",
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          refresh_token_expires_in: 7200,
        });
      },
    ),

    http.get("https://sso.garmin.com/sso/embed", async ({ request }) => {
      await capture("widget-embed", request);
      return new HttpResponse(page("GARMIN Authentication Application"), {
        headers: { "content-type": "text/html", "set-cookie": "WIDGET_SESSION=w1; Path=/" },
      });
    }),

    http.get("https://sso.garmin.com/sso/signin", async ({ request }) => {
      await capture("widget-signin-page", request);
      const body = widgetOutcome === "no_csrf" ? "<form></form>" : csrfInput("csrf-1");
      return new HttpResponse(page("GARMIN Authentication Application", body), {
        headers: { "content-type": "text/html" },
      });
    }),

    http.post("https://sso.garmin.com/sso/signin", async ({ request }) => {
      await capture("widget-signin", request);
      const html = { headers: { "content-type": "text/html" } };
      if (widgetOutcome === "rate_limited") {
        return new HttpResponse("Too Many Requests", { status: 429 });
      }
      if (widgetOutcome === "bad_credentials") {
        return new HttpResponse(page("Invalid sign in"), html);
      }
      if (widgetOutcome === "mfa") return new HttpResponse(mfaPage(""), html);
      if (widgetOutcome === "mfa_code_sent") {
        return new HttpResponse(mfaPage("j***@example.com"), html);
      }
      if (widgetOutcome === "success_no_ticket") return new HttpResponse(page("Success"), html);
      return new HttpResponse(successPage(widgetTicket), html);
    }),

    http.post("https://sso.garmin.com/sso/verifyMFA/mfaCode", async ({ request }) => {
      await capture("widget-mfa-request", request);
      return HttpResponse.json({});
    }),

    http.post("https://sso.garmin.com/sso/verifyMFA/loginEnterMfaCode", async ({ request }) => {
      const captured = await capture("widget-mfa", request);
      const code = new URLSearchParams(captured.text).get("mfa-code");
      const html = { headers: { "content-type": "text/html" } };
      if (scenario.mfaCode && code !== scenario.mfaCode) {
        return new HttpResponse(page("Enter MFA code"), html);
      }
      return new HttpResponse(successPage(widgetTicket), html);
    }),
  );

  return { server, calls, requests };
}

/** One request as the Fetcher library itself sent it, before msw ever sees it. */
export interface SentRequest {
  url: string;
  method: string;
  cookie: string | null;
}

/**
 * A `fetchImpl` that records the headers `Fetcher` itself builds, then forwards to the real
 * (msw-mocked) `fetch`. Use this — not `CapturedRequest.cookie` from `makeSsoServer` — to assert
 * on what our own `CookieJar` sent: msw keeps a module-level cookie store (see
 * `node_modules/msw/lib/core/utils/{cookieStore,request/getRequestCookies}.mjs`) that
 * unconditionally re-appends every previously-seen `Set-Cookie` onto the *captured* request's
 * `Cookie` header for any handler matching the same origin — regardless of which `Fetcher`/
 * `CookieJar` instance actually issued the request, and it persists across `server.close()` into
 * later tests. Recording at the library boundary (via `fetchImpl`, which `Fetcher.withFreshJar()`
 * carries over) observes the real Cookie header before msw's interceptor mutates it.
 */
export function recordingFetch(): { fetchImpl: typeof fetch; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    sent.push({
      url: String(input instanceof Request ? input.url : input),
      method: init?.method ?? (input instanceof Request ? input.method : "GET"),
      cookie: new Headers(init?.headers).get("cookie"),
    });
    return fetch(input, init);
  };
  return { fetchImpl, sent };
}
