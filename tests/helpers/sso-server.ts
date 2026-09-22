import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

export interface SsoScenario {
  /**
   * "success" | "mfa" | "bad_credentials" | "successful_no_ticket" |
   * "no_response_status"
   */
  loginOutcome?:
    | "success"
    | "mfa"
    | "bad_credentials"
    | "successful_no_ticket"
    | "no_response_status";
  ticket?: string;
  mfaCode?: string;
  /** Overrides the raw form-urlencoded body returned by the preauthorized (oauth1) step. */
  oauth1Body?: string;
}

/** One HTTP request the fake server observed, for asserting on shape. */
export interface CapturedRequest {
  step: string;
  url: string;
  authorization: string | null;
  /** Parsed JSON body, when the request had a JSON content-type. */
  json?: unknown;
  /** Raw text body, always captured. */
  text: string;
}

export function makeSsoServer(scenario: SsoScenario = {}) {
  const ticket = scenario.ticket ?? "ST-12345";
  const outcome = scenario.loginOutcome ?? "success";
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
  );

  return { server, calls, requests };
}
