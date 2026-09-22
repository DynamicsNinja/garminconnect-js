import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

export interface SsoScenario {
  /** "success" | "mfa" | "bad_credentials" */
  loginOutcome?: "success" | "mfa" | "bad_credentials";
  ticket?: string;
  mfaCode?: string;
}

export function makeSsoServer(scenario: SsoScenario = {}) {
  const ticket = scenario.ticket ?? "ST-12345";
  const outcome = scenario.loginOutcome ?? "success";
  const calls: string[] = [];

  const server = setupServer(
    http.get("https://thegarth.s3.amazonaws.com/oauth_consumer.json", () => {
      calls.push("consumer");
      return HttpResponse.json({ consumer_key: "ck", consumer_secret: "cs" });
    }),

    http.get("https://sso.garmin.com/sso/mobile/sso/en/sign-in", () => {
      calls.push("sign-in");
      return new HttpResponse("<html></html>", {
        headers: { "set-cookie": "SESSION=seed; Path=/" },
      });
    }),

    http.post("https://sso.garmin.com/sso/mobile/api/login", () => {
      calls.push("login");
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
      return HttpResponse.json({
        responseStatus: { type: "INVALID_USERNAME_PASSWORD", message: "Bad creds" },
      });
    }),

    http.post("https://sso.garmin.com/sso/mobile/api/mfa/verifyCode", async ({ request }) => {
      calls.push("mfa");
      const body = (await request.json()) as { mfaVerificationCode: string };
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

    http.get("https://sso.garmin.com/sso/portal/sso/embed", () => {
      calls.push("embed");
      return new HttpResponse("", { headers: { "set-cookie": "LB=node1; Path=/" } });
    }),

    http.get(
      "https://connectapi.garmin.com/oauth-service/oauth/preauthorized",
      ({ request }) => {
        calls.push("preauthorized");
        const auth = request.headers.get("authorization") ?? "";
        if (!auth.startsWith("OAuth ")) {
          return new HttpResponse("unsigned", { status: 401 });
        }
        return new HttpResponse(
          "oauth_token=o1tok&oauth_token_secret=o1sec&mfa_token=mfatok",
          { headers: { "content-type": "application/x-www-form-urlencoded" } },
        );
      },
    ),

    http.post(
      "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0",
      async ({ request }) => {
        calls.push("exchange");
        const auth = request.headers.get("authorization") ?? "";
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

  return { server, calls };
}
