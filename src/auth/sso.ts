import { GarminAuthError } from "../errors.js";
import type { Fetcher } from "../http/fetcher.js";
import type { SerializedCookie } from "../http/cookie-jar.js";
import { fetchConsumer } from "./consumer.js";
import { buildOAuth1Header } from "./oauth1.js";
import { CLIENT_ID, OAUTH_USER_AGENT, SSO_PAGE_HEADERS } from "./constants.js";
import {
  setExpirations,
  type OAuth1Token,
  type OAuth2Token,
  type RawOAuth2Token,
} from "./tokens.js";

const SSO_SUCCESSFUL = "SUCCESSFUL";
const SSO_MFA_REQUIRED = "MFA_REQUIRED";

export interface SsoContext {
  fetcher: Fetcher;
  domain: string;
}

export interface LoginParams {
  clientId: string;
  locale: string;
  service: string;
}

export interface MfaState {
  loginParams: LoginParams;
  mfaMethod: string;
  cookies: SerializedCookie[];
  domain: string;
}

export type LoginResult =
  | { state: "success"; oauth1: OAuth1Token; oauth2: OAuth2Token }
  | { state: "mfa_required"; mfaState: MfaState };

interface SsoResponse {
  responseStatus?: { type?: string; message?: string };
  serviceTicketId?: string;
  customerMfaInfo?: { mfaLastMethodUsed?: string };
}

function ssoUrl(domain: string, path: string): string {
  return `https://sso.${domain}/sso${path}`;
}

function requireSuccess(body: SsoResponse): SsoResponse {
  const type = body.responseStatus?.type ?? "UNKNOWN";
  if (type !== SSO_SUCCESSFUL) {
    const message = body.responseStatus?.message;
    throw new GarminAuthError(`SSO error: ${message ? `${type}: ${message}` : type}`);
  }
  return body;
}

export function loginParamsFor(domain: string): LoginParams {
  return {
    clientId: CLIENT_ID,
    locale: "en-US",
    service: `https://mobile.integration.${domain}/gcm/android`,
  };
}

export async function login(
  email: string,
  password: string,
  ctx: SsoContext,
): Promise<LoginResult> {
  const params = loginParamsFor(ctx.domain);

  // 1. Seed cookies.
  await ctx.fetcher.request(ssoUrl(ctx.domain, "/mobile/sso/en/sign-in"), {
    params: { clientId: CLIENT_ID },
    headers: { ...SSO_PAGE_HEADERS, "Sec-Fetch-Site": "none" },
  });

  // 2. Submit credentials.
  const res = await ctx.fetcher.request(ssoUrl(ctx.domain, "/mobile/api/login"), {
    method: "POST",
    params: { ...params },
    headers: SSO_PAGE_HEADERS,
    json: { username: email, password, rememberMe: false, captchaToken: "" },
  });
  const body = (await res.json()) as SsoResponse;
  const type = body.responseStatus?.type;

  if (type === SSO_MFA_REQUIRED) {
    return {
      state: "mfa_required",
      mfaState: {
        loginParams: params,
        mfaMethod: body.customerMfaInfo?.mfaLastMethodUsed ?? "email",
        cookies: ctx.fetcher.jar.toJSON(),
        domain: ctx.domain,
      },
    };
  }

  requireSuccess(body);
  const ticket = body.serviceTicketId;
  if (!ticket) throw new GarminAuthError("SSO succeeded but returned no service ticket");
  return completeLogin(ticket, ctx);
}

export async function completeLogin(
  ticket: string,
  ctx: SsoContext,
): Promise<{ state: "success"; oauth1: OAuth1Token; oauth2: OAuth2Token }> {
  // Best-effort: sets a Cloudflare load-balancer cookie pinning the backend.
  try {
    await ctx.fetcher.request(ssoUrl(ctx.domain, "/portal/sso/embed"), {
      headers: { ...SSO_PAGE_HEADERS, "Sec-Fetch-Site": "same-origin" },
      referer: true,
    });
  } catch {
    // Non-fatal; login works without it.
  }

  const oauth1 = await getOauth1Token(ticket, ctx);
  const oauth2 = await exchange(oauth1, ctx, { login: true });
  return { state: "success", oauth1, oauth2 };
}

export async function getOauth1Token(
  ticket: string,
  ctx: SsoContext,
): Promise<OAuth1Token> {
  const consumer = await fetchConsumer(ctx.fetcher);
  const loginUrl = `https://mobile.integration.${ctx.domain}/gcm/android`;
  const url =
    `https://connectapi.${ctx.domain}/oauth-service/oauth/preauthorized` +
    `?ticket=${encodeURIComponent(ticket)}` +
    `&login-url=${encodeURIComponent(loginUrl)}` +
    `&accepts-mfa-tokens=true`;

  const authorization = buildOAuth1Header({
    method: "GET",
    url,
    consumerKey: consumer.consumer_key,
    consumerSecret: consumer.consumer_secret,
  });

  const res = await ctx.fetcher.request(url, {
    headers: { authorization, "User-Agent": OAUTH_USER_AGENT },
  });

  const parsed = new URLSearchParams(await res.text());
  const oauth_token = parsed.get("oauth_token");
  const oauth_token_secret = parsed.get("oauth_token_secret");
  if (!oauth_token || !oauth_token_secret) {
    throw new GarminAuthError("OAuth1 exchange returned no token");
  }
  return {
    oauth_token,
    oauth_token_secret,
    mfa_token: parsed.get("mfa_token") ?? undefined,
    mfa_expiration_timestamp: parsed.get("mfa_expiration_timestamp") ?? undefined,
    domain: ctx.domain,
  };
}

export async function exchange(
  oauth1: OAuth1Token,
  ctx: SsoContext,
  opts: { login?: boolean } = {},
): Promise<OAuth2Token> {
  const consumer = await fetchConsumer(ctx.fetcher);
  const url = `https://connectapi.${ctx.domain}/oauth-service/oauth/exchange/user/2.0`;

  const bodyParams: Record<string, string> = {};
  if (opts.login) bodyParams["audience"] = "GARMIN_CONNECT_MOBILE_ANDROID_DI";
  if (oauth1.mfa_token) bodyParams["mfa_token"] = oauth1.mfa_token;

  const authorization = buildOAuth1Header({
    method: "POST",
    url,
    consumerKey: consumer.consumer_key,
    consumerSecret: consumer.consumer_secret,
    token: oauth1.oauth_token,
    tokenSecret: oauth1.oauth_token_secret,
    bodyParams,
  });

  const res = await ctx.fetcher.request(url, {
    method: "POST",
    headers: {
      authorization,
      "User-Agent": OAUTH_USER_AGENT,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(bodyParams).toString(),
  });

  return setExpirations((await res.json()) as RawOAuth2Token);
}
