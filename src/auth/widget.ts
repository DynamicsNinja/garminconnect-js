/**
 * Garmin's SSO web widget (`/sso/embed` + `/sso/signin`): the HTML form sign-in garth used before
 * the mobile JSON API. It sends no `clientId`, so it sits outside the rate-limit bucket that
 * blocks the mobile route, and `login()` falls back to it when that route answers 429.
 */

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
