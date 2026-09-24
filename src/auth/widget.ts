/**
 * Garmin's SSO web widget (`/sso/embed` + `/sso/signin`): the HTML form sign-in garth used before
 * the mobile JSON API. It sends no `clientId`, so it sits outside the rate-limit bucket that
 * blocks the mobile route, and `login()` falls back to it when that route answers 429.
 */

import { GarminAuthError, GarminConnectionError } from "../errors.js";
import type { Fetcher } from "../http/fetcher.js";
import type { SerializedCookie } from "../http/cookie-jar.js";
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

export interface WidgetMfaState {
  flow: "widget";
  mfaMethod: string;
  csrf: string;
  signinParams: Record<string, string>;
  referer: string;
  cookies: SerializedCookie[];
  domain: string;
}

export type WidgetLoginResult = WidgetSuccess | { state: "mfa_required"; mfaState: WidgetMfaState };

const FORM_HEADERS = { ...SSO_PAGE_HEADERS, "content-type": "application/x-www-form-urlencoded" };
/** Titles of Garmin/Cloudflare error and challenge pages ("Just a moment...", "Attention Required!"). */
const SERVER_ERROR_HINTS = [
  "bad gateway",
  "service unavailable",
  "cloudflare",
  "502",
  "503",
  "just a moment",
  "attention required",
];

function isServerErrorTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return SERVER_ERROR_HINTS.some((h) => lower.includes(h));
}
const CREDENTIAL_HINTS = ["locked", "invalid", "incorrect", "account error"];
const RESTRICTED_HINTS = ["unable to sign in", "unable to login"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Email and SMS codes are not always sent by the sign-in POST itself. The page's own
 * "Request a new code" link calls this endpoint, so it is called when no code was sent.
 */
async function requestMfaCode(
  fetcher: Fetcher,
  base: string,
  vars: MfaVars,
  referer: string,
): Promise<void> {
  const method = (vars.mfaMethod ?? "").toLowerCase();
  if ((method !== "email" && method !== "sms") || vars.codeSentTo) return;
  await fetcher.request(`${base}/verifyMFA/mfaCode`, {
    method: "POST",
    params: { clientId: vars.clientId ?? "" },
    headers: { ...SSO_PAGE_HEADERS, Accept: "application/json, text/plain, */*", Referer: referer },
    json: {
      customerGuid: vars.customerGuid ?? "",
      mfaMethod: vars.mfaMethod ?? "",
      locale: vars.locale ?? "",
    },
  });
}

export async function widgetLogin(
  email: string,
  password: string,
  fetcher: Fetcher,
  domain: string,
  opts: { delayMs?: number; complete: CompleteTicket },
): Promise<WidgetLoginResult> {
  const urls = widgetUrls(domain);

  // 1. The embed page sets the widget's session cookies.
  await fetcher.request(urls.embed, { params: urls.embedParams, headers: SSO_PAGE_HEADERS });

  // 2. The sign-in page carries the CSRF token the POST must echo.
  const signinPage = await fetcher.request(urls.signin, {
    params: urls.signinParams,
    headers: { ...SSO_PAGE_HEADERS, Referer: urls.embed },
  });
  const signinHtml = await signinPage.text();
  const csrf = csrfFrom(signinHtml);
  if (!csrf) {
    // The title names what came back instead, e.g. a Cloudflare "Just a moment..." challenge.
    throw new GarminConnectionError(
      `Widget login: missing CSRF token on page '${titleFrom(signinHtml)}'`,
    );
  }
  const referer = fetcher.lastUrl ?? urls.signin;

  const delay = widgetDelayMs(opts.delayMs);
  if (delay > 0) await sleep(delay);

  // 3. Credentials go in a form body, never the URL. A POST is never retried automatically.
  const res = await fetcher.request(urls.signin, {
    method: "POST",
    params: urls.signinParams,
    headers: { ...FORM_HEADERS, Referer: referer },
    body: new URLSearchParams({ username: email, password, embed: "true", _csrf: csrf }).toString(),
    timeoutMs: 30_000,
  });
  const html = await res.text();
  const title = titleFrom(html);
  const lower = title.toLowerCase();

  if (isServerErrorTitle(title)) {
    throw new GarminConnectionError(`Widget login: server error '${title}'`);
  }
  // "SSO error:" matches the mobile route's rejections, so callers classify both the same way.
  if (CREDENTIAL_HINTS.some((h) => lower.includes(h))) {
    throw new GarminAuthError(`SSO error: INVALID_CREDENTIALS: ${title}`);
  }
  if (RESTRICTED_HINTS.some((h) => lower.includes(h))) {
    throw new GarminAuthError(`SSO error: ACCOUNT_RESTRICTED: ${title}`);
  }
  const vars = mfaVarsFrom(html);
  if (lower.includes("mfa") || vars.mfaMethod) {
    const mfaCsrf = csrfFrom(html);
    if (!mfaCsrf) throw new GarminConnectionError("Widget login: MFA page has no CSRF token");
    const mfaReferer = fetcher.lastUrl ?? urls.signin;
    await requestMfaCode(fetcher, urls.base, vars, mfaReferer);
    return {
      state: "mfa_required",
      mfaState: {
        flow: "widget",
        mfaMethod: vars.mfaMethod || "email",
        csrf: mfaCsrf,
        signinParams: urls.signinParams,
        referer: mfaReferer,
        cookies: fetcher.jar.toJSON(),
        domain,
      },
    };
  }
  if (title !== "Success") {
    throw new GarminConnectionError(`Widget login: unexpected page '${title}'`);
  }
  const ticket = ticketFrom(html);
  if (!ticket) throw new GarminAuthError("Widget login: missing service ticket");
  return opts.complete(ticket, urls.embed);
}

export async function widgetResume(
  state: WidgetMfaState,
  code: string,
  fetcher: Fetcher,
  complete: CompleteTicket,
): Promise<WidgetSuccess> {
  fetcher.jar.mergeFromJSON(state.cookies);
  const urls = widgetUrls(state.domain);
  const res = await fetcher.request(`${urls.base}/verifyMFA/loginEnterMfaCode`, {
    method: "POST",
    params: state.signinParams,
    headers: { ...FORM_HEADERS, Referer: state.referer },
    body: new URLSearchParams({
      "mfa-code": code,
      embed: "true",
      _csrf: state.csrf,
      fromPage: "setupEnterMfaCode",
    }).toString(),
    timeoutMs: 30_000,
  });
  const html = await res.text();
  const title = titleFrom(html);
  // An outage is not a wrong code: report it as retryable, not as an auth failure.
  if (isServerErrorTitle(title)) {
    throw new GarminConnectionError(`Widget MFA: server error '${title}'`);
  }
  if (title !== "Success") throw new GarminAuthError(`SSO error: INVALID_MFA_CODE: ${title}`);
  const ticket = ticketFrom(html);
  if (!ticket) throw new GarminAuthError("Widget login: missing service ticket");
  return complete(ticket, urls.embed);
}
