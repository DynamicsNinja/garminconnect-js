/**
 * Garmin's SSO web widget (`/sso/embed` + `/sso/signin`): the HTML form sign-in garth used before
 * the mobile JSON API. It sends no `clientId`, so it sits outside the rate-limit bucket that
 * blocks the mobile route, and `login()` falls back to it when that route answers 429.
 */

import { GarminAuthError, GarminConnectionError } from "../errors.js";
import type { Fetcher } from "../http/fetcher.js";
import { SSO_PAGE_HEADERS } from "./constants.js";
import type { OAuth1Token, OAuth2Token } from "./tokens.js";

export interface WidgetUrls {
  base: string;
  embed: string;
  signin: string;
  embedParams: Record<string, string>;
  signinParams: Record<string, string>;
}

export function widgetUrls(domain: string): WidgetUrls {
  const base = `https://sso.${domain}/sso`;
  const embed = `${base}/embed`;
  const embedParams = { id: "gauth-widget", embedWidget: "true", gauthHost: base };
  return {
    base,
    embed,
    signin: `${base}/signin`,
    embedParams,
    signinParams: {
      ...embedParams,
      gauthHost: embed,
      service: embed,
      source: embed,
      redirectAfterAccountLoginUrl: embed,
      redirectAfterAccountCreationUrl: embed,
    },
  };
}

const CSRF_RE = /name="_csrf"\s+value="(.+?)"/;
const TITLE_RE = /<title>([\s\S]*?)<\/title>/i;
const TICKET_RE = /\?ticket=(ST-[^"&\s]+)/;
const MFA_VAR_RE = /var\s+(customerGuid|mfaMethod|locale|clientId|codeSentTo)\s*=\s*"([^"]*)"\s*;/g;

export type MfaVars = Partial<
  Record<"customerGuid" | "mfaMethod" | "locale" | "clientId" | "codeSentTo", string>
>;

export function csrfFrom(html: string): string | null {
  return CSRF_RE.exec(html)?.[1] ?? null;
}

export function titleFrom(html: string): string {
  return TITLE_RE.exec(html)?.[1]?.trim() ?? "";
}

export function ticketFrom(html: string): string | null {
  return TICKET_RE.exec(html)?.[1] ?? null;
}

/** The inline `var name = "value";` declarations Garmin's MFA page carries. */
export function mfaVarsFrom(html: string): MfaVars {
  const vars: MfaVars = {};
  for (const [, name, value] of html.matchAll(MFA_VAR_RE)) {
    if (name !== undefined && value !== undefined) vars[name as keyof MfaVars] = value;
  }
  return vars;
}

/** Pause before posting credentials; Cloudflare flags an instant GET-then-POST as a bot. */
export function widgetDelayMs(override?: number): number {
  return override ?? 3000 + Math.floor(Math.random() * 5001);
}

export type WidgetSuccess = { state: "success"; oauth1: OAuth1Token; oauth2: OAuth2Token };
/** Turns a service ticket into tokens; `sso.ts` passes `completeLogin` so there is no import cycle. */
export type CompleteTicket = (ticket: string, loginUrl: string) => Promise<WidgetSuccess>;

const FORM_HEADERS = { ...SSO_PAGE_HEADERS, "content-type": "application/x-www-form-urlencoded" };
const SERVER_ERROR_HINTS = ["bad gateway", "service unavailable", "cloudflare", "502", "503"];
const CREDENTIAL_HINTS = ["locked", "invalid", "incorrect", "account error"];
const RESTRICTED_HINTS = ["unable to sign in", "unable to login"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function widgetLogin(
  email: string,
  password: string,
  fetcher: Fetcher,
  domain: string,
  opts: { delayMs?: number; complete: CompleteTicket },
): Promise<WidgetSuccess> {
  const urls = widgetUrls(domain);

  // 1. The embed page sets the widget's session cookies.
  await fetcher.request(urls.embed, { params: urls.embedParams, headers: SSO_PAGE_HEADERS });

  // 2. The sign-in page carries the CSRF token the POST must echo.
  const signinPage = await fetcher.request(urls.signin, {
    params: urls.signinParams,
    headers: { ...SSO_PAGE_HEADERS, Referer: urls.embed },
  });
  const csrf = csrfFrom(await signinPage.text());
  if (!csrf) throw new GarminConnectionError("Widget login: missing CSRF token");
  const referer = fetcher.lastUrl ?? urls.signin;

  const delay = widgetDelayMs(opts.delayMs);
  if (delay > 0) await sleep(delay);

  // 3. Credentials go in a form body, never the URL. A POST is never retried automatically.
  const res = await fetcher.request(urls.signin, {
    method: "POST",
    params: urls.signinParams,
    headers: { ...FORM_HEADERS, Referer: referer },
    body: new URLSearchParams({ username: email, password, embed: "true", _csrf: csrf }).toString(),
  });
  const html = await res.text();
  const title = titleFrom(html);
  const lower = title.toLowerCase();

  if (SERVER_ERROR_HINTS.some((h) => lower.includes(h))) {
    throw new GarminConnectionError(`Widget login: server error '${title}'`);
  }
  // "SSO error:" matches the mobile route's rejections, so callers classify both the same way.
  if (CREDENTIAL_HINTS.some((h) => lower.includes(h))) {
    throw new GarminAuthError(`SSO error: INVALID_CREDENTIALS: ${title}`);
  }
  if (RESTRICTED_HINTS.some((h) => lower.includes(h))) {
    throw new GarminAuthError(`SSO error: ACCOUNT_RESTRICTED: ${title}`);
  }
  if (title !== "Success") {
    throw new GarminConnectionError(`Widget login: unexpected page '${title}'`);
  }
  const ticket = ticketFrom(html);
  if (!ticket) throw new GarminAuthError("Widget login: missing service ticket");
  return opts.complete(ticket, urls.embed);
}
