# Widget Login Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Garmin rate limits the mobile SSO login step, `login()` signs in through the SSO web widget in the same call. It returns the same OAuth1/OAuth2 tokens, and the code step works through a serialisable `MfaState`.

**Architecture:**
- A new `src/auth/widget.ts` holds the widget flow and its HTML parsing. The parsing is pure functions over strings.
- `src/auth/sso.ts` detects a rate-limited mobile credentials step and calls the widget flow with a fresh cookie jar. `resumeLogin` sends `flow: "widget"` states to the widget code.
- The widget ticket goes through the existing `completeLogin`, with `login-url` set to the widget's embed URL.
- `widget.ts` receives `completeLogin` as a callback and imports only types from `sso.ts`, so there is no runtime import cycle.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Node ≥ 18 `fetch`, Vitest 2, msw 2 (fake Garmin server), tsup.

**Spec:** `docs/superpowers/specs/2026-09-24-widget-login-fallback-design.md`

## Global Constraints

- Zero runtime dependencies; Node runtime only.
- Token model unchanged: `Tokens = { oauth1, oauth2 }`, and `TokenStore` / `FileTokenStore` are untouched.
- Fallback trigger is only a rate-limited mobile credentials step: HTTP 429 on `GET /mobile/sso/en/sign-in` or `POST /mobile/api/login`, or a 200 JSON body with `error["status-code"] === "429"`. Nothing else falls back.
- Widget URLs: `SSO_BASE = https://sso.<domain>/sso`, `EMBED = <SSO_BASE>/embed`, `embedParams = { id: "gauth-widget", embedWidget: "true", gauthHost: SSO_BASE }`, `signinParams = { ...embedParams, gauthHost: EMBED, service: EMBED, source: EMBED, redirectAfterAccountLoginUrl: EMBED, redirectAfterAccountCreationUrl: EMBED }`.
- Widget ticket OAuth1 `login-url` = `EMBED`; mobile keeps `https://mobile.integration.<domain>/gcm/android`.
- Wrong password or code on the widget: `GarminAuthError` whose message starts with `SSO error:` (`INVALID_CREDENTIALS`, `ACCOUNT_RESTRICTED`, `INVALID_MFA_CODE`).
- Delay before the widget credential POST: random 3000–8000 ms, overridden by `GarminClientOptions.loginDelayMs` (`SsoContext.loginDelayMs`).
- `MfaState` without `flow` is treated as mobile. New mobile states carry `flow: "mobile"`.
- Release as `0.3.0` (0.2.0 is already released).
- Repo conventions: commit on `main`, Conventional-Commit subjects (`feat:`, `test:`, `docs:`, `chore:`). Every commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. `npm run check` = typecheck + lint + build + tests.

## Review Focus

1. **Cookies from the widget embed GET must reach the widget POSTs, and must survive `JSON.stringify` into `resumeLogin` on a brand-new `Fetcher`.** Otherwise the code step silently fails in a two-request server flow. Task 3 tests a round-tripped state on a fresh `Fetcher` and asserts the cookie header.
2. **A rate limit after the credentials step must NOT fall back.** Examples are a 429 from `preauthorized` or `exchange/user/2.0`: falling back would run a second password sign-in for a user whose password was already accepted. Task 2 tests a 429 on `preauthorized`.
3. **The password must never be in a URL or a thrown message on the widget path.** Task 2 asserts the POST URL, and Task 2's wrong-password test asserts the error message has no password.
4. **A `0.1.0`-shaped mobile `MfaState` (no `flow`) must still resume** through `/mobile/api/mfa/verifyCode`. Task 3 tests it.
5. **The widget flow must not reuse the mobile route's cookie jar**, so stale mobile SSO cookies can't confuse the widget session. It must still use the caller's `fetchImpl`, or consumers that inject `fetchImpl` would bypass it. Task 1 tests both halves of `Fetcher.withFreshJar()`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/http/fetcher.ts` (modify) | `withFreshJar()`: the same options, a new empty `CookieJar` |
| `src/auth/widget.ts` (new) | Widget URLs, HTML helpers, delay helper, `widgetLogin`, `widgetResume`, `WidgetMfaState` |
| `src/auth/sso.ts` (modify) | `SsoContext.loginDelayMs`, rate-limit detection and fallback, `loginUrl` on `completeLogin`/`getOauth1Token`, `MfaState` union, `resumeLogin` dispatch |
| `src/client.ts` (modify) | `GarminClientOptions.loginDelayMs` passed into `SsoContext` |
| `src/index.ts` (modify) | Export `MobileMfaState`, `WidgetMfaState` types |
| `tests/helpers/sso-server.ts` (modify) | Mobile `rate_limited` outcomes, widget handlers, cookie, referer and content-type captured |
| `tests/http/fetcher.test.ts` (modify) | `withFreshJar` tests |
| `tests/auth/widget-html.test.ts` (new) | Helper unit tests |
| `tests/auth/widget.test.ts` (new) | Fallback flow tests through `login` / `resumeLogin` |
| `tests/auth/sso.test.ts`, `tests/auth/sso-mfa.test.ts` (modify) | Narrow `mfaState` before reading `loginParams` |
| `tests/client.test.ts` (modify) | `loginDelayMs` through `GarminClient` |
| `AGENTS.md`, `README.md`, `CHANGELOG.md`, `package.json` | Docs and the `0.3.0` release |

---

### Task 1: Fresh-jar fetcher and widget HTML helpers

**Files:**
- Modify: `src/http/fetcher.ts`
- Create: `src/auth/widget.ts` (helpers only in this task)
- Test: `tests/http/fetcher.test.ts` (append), `tests/auth/widget-html.test.ts` (new)

**Interfaces:**
- Produces:
  - `Fetcher.withFreshJar(): Fetcher`
  - `widgetUrls(domain: string): { base: string; embed: string; signin: string; embedParams: Record<string, string>; signinParams: Record<string, string> }`
  - `csrfFrom(html: string): string | null`
  - `titleFrom(html: string): string` (trimmed, `""` when absent)
  - `ticketFrom(html: string): string | null`
  - `mfaVarsFrom(html: string): Partial<Record<"customerGuid" | "mfaMethod" | "locale" | "clientId" | "codeSentTo", string>>`
  - `widgetDelayMs(override?: number): number`

- [ ] **Step 1: Write the failing tests**

Append to `tests/http/fetcher.test.ts` (keep the existing imports; add any of `describe`, `expect`, `it`, `vi`, `Fetcher` that are missing):

```ts
describe("withFreshJar", () => {
  it("starts with no cookies but keeps the caller's fetchImpl", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response("ok", { headers: { "set-cookie": "A=1; Path=/" } }),
    );
    const original = new Fetcher({ fetchImpl, retries: 0 });
    await original.request("https://sso.garmin.com/x");
    expect(original.jar.cookieHeaderFor("https://sso.garmin.com/y")).toBe("A=1");

    const fresh = original.withFreshJar();
    expect(fresh).not.toBe(original);
    expect(fresh.jar.cookieHeaderFor("https://sso.garmin.com/y")).toBeUndefined();

    await fresh.request("https://sso.garmin.com/z");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const init = fetchImpl.mock.calls[1]?.[1];
    expect(new Headers(init?.headers).get("cookie")).toBeNull();
  });
});
```

Create `tests/auth/widget-html.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  csrfFrom,
  mfaVarsFrom,
  ticketFrom,
  titleFrom,
  widgetDelayMs,
  widgetUrls,
} from "../../src/auth/widget.js";

describe("widgetUrls", () => {
  it("builds the embed and signin parameters for a domain", () => {
    const u = widgetUrls("garmin.com");
    expect(u.base).toBe("https://sso.garmin.com/sso");
    expect(u.embed).toBe("https://sso.garmin.com/sso/embed");
    expect(u.signin).toBe("https://sso.garmin.com/sso/signin");
    expect(u.embedParams).toEqual({
      id: "gauth-widget",
      embedWidget: "true",
      gauthHost: "https://sso.garmin.com/sso",
    });
    expect(u.signinParams).toEqual({
      id: "gauth-widget",
      embedWidget: "true",
      gauthHost: "https://sso.garmin.com/sso/embed",
      service: "https://sso.garmin.com/sso/embed",
      source: "https://sso.garmin.com/sso/embed",
      redirectAfterAccountLoginUrl: "https://sso.garmin.com/sso/embed",
      redirectAfterAccountCreationUrl: "https://sso.garmin.com/sso/embed",
    });
    expect(widgetUrls("garmin.cn").embed).toBe("https://sso.garmin.cn/sso/embed");
  });
});

describe("HTML helpers", () => {
  it("reads the CSRF token", () => {
    expect(csrfFrom('<input type="hidden" name="_csrf" value="abc-123" />')).toBe("abc-123");
    expect(csrfFrom("<form></form>")).toBeNull();
  });

  it("reads and trims the page title", () => {
    expect(titleFrom("<html><head><title> Success </title></head></html>")).toBe("Success");
    expect(titleFrom("<TITLE>GARMIN Authentication Application</TITLE>")).toBe(
      "GARMIN Authentication Application",
    );
    expect(titleFrom("<html></html>")).toBe("");
  });

  it("reads the service ticket", () => {
    expect(ticketFrom('var u = "https://sso.garmin.com/sso/embed?ticket=ST-0123-abc";')).toBe(
      "ST-0123-abc",
    );
    expect(ticketFrom("embed?ticket=ST-9&x=1")).toBe("ST-9");
    expect(ticketFrom("no ticket here")).toBeNull();
  });

  it("reads the MFA page's inline variables", () => {
    const html =
      '<script>var customerGuid = "guid-1"; var mfaMethod = "email"; var locale = "en_US";' +
      ' var clientId = "GarminConnect"; var codeSentTo = "";</script>';
    expect(mfaVarsFrom(html)).toEqual({
      customerGuid: "guid-1",
      mfaMethod: "email",
      locale: "en_US",
      clientId: "GarminConnect",
      codeSentTo: "",
    });
    expect(mfaVarsFrom("<html></html>")).toEqual({});
  });
});

describe("widgetDelayMs", () => {
  it("honours an override, including 0", () => {
    expect(widgetDelayMs(0)).toBe(0);
    expect(widgetDelayMs(1234)).toBe(1234);
  });

  it("defaults to between 3 and 8 seconds", () => {
    for (let i = 0; i < 50; i++) {
      const ms = widgetDelayMs();
      expect(ms).toBeGreaterThanOrEqual(3000);
      expect(ms).toBeLessThanOrEqual(8000);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/http/fetcher.test.ts tests/auth/widget-html.test.ts`
Expected: FAIL. `fresh.withFreshJar is not a function`, and `Failed to resolve import "../../src/auth/widget.js"`.

- [ ] **Step 3: Implement**

In `src/http/fetcher.ts`, store the options and add the method:

```ts
export class Fetcher {
  readonly jar: CookieJar;
  lastUrl: string | undefined;

  readonly #options: FetcherOptions;
  readonly #timeoutMs: number;
  readonly #retries: number;
  readonly #backoffMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: FetcherOptions = {}) {
    this.#options = options;
    this.jar = options.jar ?? new CookieJar();
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#retries = options.retries ?? 3;
    this.#backoffMs = options.backoffMs ?? 500;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
  }

  /**
   * The same timeouts, retries and `fetchImpl`, with an empty cookie jar. The SSO widget sign-in
   * uses it so cookies left by a failed mobile sign-in never mix into the widget's session.
   */
  withFreshJar(): Fetcher {
    return new Fetcher({ ...this.#options, jar: new CookieJar() });
  }
```

(the rest of the class is unchanged).

Create `src/auth/widget.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/http/fetcher.test.ts tests/auth/widget-html.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/http/fetcher.ts src/auth/widget.ts tests/http/fetcher.test.ts tests/auth/widget-html.test.ts
git commit -m "feat: fresh-jar fetcher and SSO widget HTML helpers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Fall back to the widget when the mobile login is rate limited

**Files:**
- Modify: `tests/helpers/sso-server.ts`, `src/auth/sso.ts`, `src/auth/widget.ts`
- Test: `tests/auth/widget.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 helpers, `Fetcher.withFreshJar()`.
- Produces:
  - `SsoContext.loginDelayMs?: number`
  - `completeLogin(ticket, ctx, loginUrl?)` and `getOauth1Token(ticket, ctx, loginUrl?)`. `loginUrl` defaults to `mobileLoginUrl(ctx.domain)`, so current callers are unchanged.
  - `mobileLoginUrl(domain: string): string`
  - In widget.ts: `type WidgetSuccess = { state: "success"; oauth1: OAuth1Token; oauth2: OAuth2Token }`, `type CompleteTicket = (ticket: string, loginUrl: string) => Promise<WidgetSuccess>`, and `widgetLogin(email, password, fetcher: Fetcher, domain: string, opts: { delayMs?: number; complete: CompleteTicket }): Promise<WidgetSuccess>`. Task 3 widens the return type to include `mfa_required`.
  - Harness: `SsoScenario.loginOutcome` gains `"rate_limited" | "rate_limited_json"`. New `widgetOutcome?: "success" | "mfa" | "mfa_code_sent" | "bad_credentials" | "rate_limited" | "no_csrf" | "success_no_ticket"` and `widgetTicket?: string`. New `preauthorizedRateLimited?: boolean`. `CapturedRequest` gains `cookie`, `referer`, `contentType`.

- [ ] **Step 1: Extend the fake SSO server**

In `tests/helpers/sso-server.ts`:

1. Extend the scenario and captured request types:

```ts
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

export interface CapturedRequest {
  step: string;
  url: string;
  authorization: string | null;
  cookie: string | null;
  referer: string | null;
  contentType: string | null;
  json?: unknown;
  text: string;
}
```

2. In `capture`, fill the new fields:

```ts
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
```

3. Add page helpers above `makeSsoServer`:

```ts
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
```

4. Inside `makeSsoServer`, add `const widgetTicket = scenario.widgetTicket ?? "ST-W1";` and `const widgetOutcome = scenario.widgetOutcome ?? "success";`. In the `POST /mobile/api/login` handler, before `if (outcome === "success")`:

```ts
      if (outcome === "rate_limited") {
        return new HttpResponse("Too Many Requests", { status: 429 });
      }
      if (outcome === "rate_limited_json") {
        return HttpResponse.json({ error: { "status-code": "429", message: "Too many requests" } });
      }
```

5. In the `preauthorized` handler, right after `capture`:

```ts
        if (scenario.preauthorizedRateLimited) {
          return new HttpResponse("Too Many Requests", { status: 429 });
        }
```

6. Add the widget handlers to the `setupServer(...)` list:

```ts
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
```

- [ ] **Step 2: Write the failing tests**

Create `tests/auth/widget.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
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

  it("does not send mobile cookies to the widget", async () => {
    const h = serve({ loginOutcome: "rate_limited" });
    await login("a@b.test", "pw", ctx());
    const embed = h.requests.find((r) => r.step === "widget-embed")!;
    expect(embed.cookie ?? "").not.toContain("SESSION=seed");
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/auth/widget.test.ts`
Expected: FAIL. The fallback cases reject with `GarminRateLimitError` for `/mobile/api/login`, or with `SSO error: UNKNOWN` for the JSON 429, because no fallback exists yet. The "no fallback" cases may already pass.

- [ ] **Step 4: Implement the widget sign-in**

Append to `src/auth/widget.ts`. The imports go at the top of the file, above the Task 1 code:

```ts
import { GarminAuthError, GarminConnectionError } from "../errors.js";
import type { Fetcher } from "../http/fetcher.js";
import { SSO_PAGE_HEADERS } from "./constants.js";
import type { OAuth1Token, OAuth2Token } from "./tokens.js";
```

```ts
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
```

- [ ] **Step 5: Wire the fallback into `src/auth/sso.ts`**

1. Imports: add `GarminRateLimitError` to the errors import, and add `import { widgetLogin } from "./widget.js";`.
2. `SsoContext`:

```ts
export interface SsoContext {
  fetcher: Fetcher;
  domain: string;
  /** Pause before the widget's credential POST, in ms; default random 3000–8000. */
  loginDelayMs?: number;
}
```

3. Add `error?: { "status-code"?: string }` to `SsoResponse`.
4. Replace `login()` with the following. Keep `loginParamsFor`, `parseJson` and `requireSuccess` as they are.

```ts
export function mobileLoginUrl(domain: string): string {
  return `https://mobile.integration.${domain}/gcm/android`;
}

/** The mobile credentials step, or `"rate_limited"` when Garmin refused it with a 429. */
async function mobileCredentials(
  email: string,
  password: string,
  ctx: SsoContext,
  params: LoginParams,
): Promise<SsoResponse | "rate_limited"> {
  let res: Response;
  try {
    // 1. Seed cookies.
    await ctx.fetcher.request(ssoUrl(ctx.domain, "/mobile/sso/en/sign-in"), {
      params: { clientId: CLIENT_ID },
      headers: { ...SSO_PAGE_HEADERS, "Sec-Fetch-Site": "none" },
    });
    // 2. Submit credentials. Opt into retrying this POST: Garmin's login endpoint is idempotent
    // in effect (re-submitting after a 5xx/network blip succeeds identically).
    res = await ctx.fetcher.request(ssoUrl(ctx.domain, "/mobile/api/login"), {
      method: "POST",
      params: { ...params },
      headers: SSO_PAGE_HEADERS,
      json: { username: email, password, rememberMe: false, captchaToken: "" },
      retry: true,
    });
  } catch (err) {
    if (err instanceof GarminRateLimitError) return "rate_limited";
    throw err;
  }
  const body = await parseJson<SsoResponse>(res);
  // Garmin sometimes reports the rate limit inside a 200 JSON body instead of an HTTP 429.
  if (body.error?.["status-code"] === "429") return "rate_limited";
  return body;
}

export async function login(
  email: string,
  password: string,
  ctx: SsoContext,
): Promise<LoginResult> {
  const params = loginParamsFor(ctx.domain);
  const body = await mobileCredentials(email, password, ctx, params);

  if (body === "rate_limited") {
    // Garmin rate limits the mobile route per client id and source. The web widget sends no
    // client id, so it is tried once before giving up; a 429 there names the widget URL.
    return widgetLogin(email, password, ctx.fetcher.withFreshJar(), ctx.domain, {
      delayMs: ctx.loginDelayMs,
      complete: (ticket, loginUrl) => completeLogin(ticket, ctx, loginUrl),
    });
  }

  const type = body.responseStatus?.type;
  if (type === SSO_MFA_REQUIRED) {
    return {
      state: "mfa_required",
      mfaState: {
        loginParams: params,
        // Upstream garth (sso.py) does `mfa_info.get("mfaLastMethodUsed")
        // or "email"` — this default mirrors that behavior, not a guess.
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
```

5. Give `completeLogin` and `getOauth1Token` a `loginUrl` parameter:

```ts
export async function completeLogin(
  ticket: string,
  ctx: SsoContext,
  loginUrl: string = mobileLoginUrl(ctx.domain),
): Promise<{ state: "success"; oauth1: OAuth1Token; oauth2: OAuth2Token }> {
  // …unchanged embed step…
  const oauth1 = await getOauth1Token(ticket, ctx, loginUrl);
  const oauth2 = await exchange(oauth1, ctx, { login: true });
  return { state: "success", oauth1, oauth2 };
}

export async function getOauth1Token(
  ticket: string,
  ctx: SsoContext,
  loginUrl: string = mobileLoginUrl(ctx.domain),
): Promise<OAuth1Token> {
  const consumer = await fetchConsumer(ctx.fetcher);
  const url =
    `https://connectapi.${ctx.domain}/oauth-service/oauth/preauthorized` +
    `?ticket=${encodeURIComponent(ticket)}` +
    `&login-url=${encodeURIComponent(loginUrl)}` +
    `&accepts-mfa-tokens=true`;
  // …rest unchanged…
```

`loginParamsFor` may use `mobileLoginUrl(domain)` for its `service`; the value is the same.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/auth`
Expected: PASS for `widget.test.ts`, `widget-html.test.ts`, and the existing `sso.test.ts` / `sso-mfa.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/auth/sso.ts src/auth/widget.ts tests/helpers/sso-server.ts tests/auth/widget.test.ts
git commit -m "feat: fall back to the SSO widget when the mobile login is rate limited

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Code step (MFA) on the widget path

**Files:**
- Modify: `src/auth/widget.ts`, `src/auth/sso.ts`, `tests/auth/sso.test.ts`, `tests/auth/sso-mfa.test.ts`
- Test: `tests/auth/widget.test.ts` (append)

**Interfaces:**
- Consumes: Task 2's `widgetLogin`, `CompleteTicket`, harness widget outcomes.
- Produces:
  - `interface WidgetMfaState { flow: "widget"; mfaMethod: string; csrf: string; signinParams: Record<string, string>; referer: string; cookies: SerializedCookie[]; domain: string }`
  - `widgetLogin(...)` now returns `Promise<WidgetSuccess | { state: "mfa_required"; mfaState: WidgetMfaState }>`
  - `widgetResume(state: WidgetMfaState, code: string, fetcher: Fetcher, complete: CompleteTicket): Promise<WidgetSuccess>`
  - sso.ts: `interface MobileMfaState { flow?: "mobile"; loginParams: LoginParams; mfaMethod: string; cookies: SerializedCookie[]; domain: string }` and `type MfaState = MobileMfaState | WidgetMfaState`. The mobile MFA branch sets `flow: "mobile"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/auth/widget.test.ts`. Add `resumeLogin` to the `../../src/auth/sso.js` import and `import type { MfaState } from "../../src/auth/sso.js";`.

```ts
describe("widget code step", () => {
  it("returns a serialisable widget MfaState and asks Garmin to send the code", async () => {
    const h = serve({ loginOutcome: "rate_limited", widgetOutcome: "mfa" });
    const result = await login("secret@b.test", "super-secret-pw", ctx());
    expect(result.state).toBe("mfa_required");
    if (result.state !== "mfa_required") throw new Error("unreachable");
    const state = result.mfaState;
    if (state.flow !== "widget") throw new Error("expected a widget state");
    expect(state.mfaMethod).toBe("email");
    expect(state.csrf).toBe("csrf-mfa");
    expect(state.domain).toBe("garmin.com");
    expect(state.signinParams.service).toBe("https://sso.garmin.com/sso/embed");
    expect(state.cookies.some((c) => c.name === "WIDGET_SESSION")).toBe(true);

    const json = JSON.stringify(state);
    expect(json).not.toContain("super-secret-pw");
    expect(json).not.toContain("secret@b.test");
    expect(JSON.parse(json)).toEqual(state);

    const request = h.requests.find((r) => r.step === "widget-mfa-request")!;
    expect(new URL(request.url).searchParams.get("clientId")).toBe("GarminConnect");
    expect(request.json).toEqual({ customerGuid: "guid-1", mfaMethod: "email", locale: "en_US" });
  });

  it("does not ask for a code Garmin already sent", async () => {
    const h = serve({ loginOutcome: "rate_limited", widgetOutcome: "mfa_code_sent" });
    const result = await login("a@b.test", "pw", ctx());
    expect(result.state).toBe("mfa_required");
    expect(h.calls).not.toContain("widget-mfa-request");
  });

  it("finishes on a fresh Fetcher from a JSON round-tripped state", async () => {
    const h = serve({ loginOutcome: "rate_limited", widgetOutcome: "mfa", mfaCode: "123456" });
    const result = await login("a@b.test", "pw", ctx());
    if (result.state !== "mfa_required") throw new Error("unreachable");
    const carried = JSON.parse(JSON.stringify(result.mfaState)) as MfaState;

    const done = await resumeLogin(carried, "123456", { fetcher: new Fetcher() });
    expect(done.oauth1.oauth_token).toBe("o1tok");

    const verify = h.requests.find((r) => r.step === "widget-mfa")!;
    const form = new URLSearchParams(verify.text);
    expect(form.get("mfa-code")).toBe("123456");
    expect(form.get("_csrf")).toBe("csrf-mfa");
    expect(form.get("embed")).toBe("true");
    expect(form.get("fromPage")).toBe("setupEnterMfaCode");
    expect(verify.cookie).toContain("WIDGET_SESSION=w1");
    expect(verify.contentType).toContain("application/x-www-form-urlencoded");

    const preauth = h.requests.filter((r) => r.step === "preauthorized").at(-1)!;
    expect(new URL(preauth.url).searchParams.get("login-url")).toBe(
      "https://sso.garmin.com/sso/embed",
    );
  });

  it("rejects a wrong code with the SSO error prefix", async () => {
    serve({ loginOutcome: "rate_limited", widgetOutcome: "mfa", mfaCode: "123456" });
    const result = await login("a@b.test", "pw", ctx());
    if (result.state !== "mfa_required") throw new Error("unreachable");
    await expect(
      resumeLogin(result.mfaState, "000000", { fetcher: new Fetcher() }),
    ).rejects.toThrow(new GarminAuthError("SSO error: INVALID_MFA_CODE: Enter MFA code"));
  });
});

describe("mobile MfaState compatibility", () => {
  it("marks new mobile states with flow: mobile", async () => {
    serve({ loginOutcome: "mfa" });
    const result = await login("a@b.test", "pw", ctx());
    if (result.state !== "mfa_required") throw new Error("unreachable");
    expect(result.mfaState.flow).toBe("mobile");
  });

  it("still resumes a 0.1.0 state that has no flow field", async () => {
    const h = serve({ loginOutcome: "mfa", mfaCode: "123456" });
    const old = {
      loginParams: {
        clientId: "GCM_ANDROID_DARK",
        locale: "en-US",
        service: "https://mobile.integration.garmin.com/gcm/android",
      },
      mfaMethod: "sms",
      cookies: [],
      domain: "garmin.com",
    } as MfaState;
    const done = await resumeLogin(old, "123456", { fetcher: new Fetcher() });
    expect(done.state).toBe("success");
    expect(h.calls).toContain("mfa");
    expect(h.calls).not.toContain("widget-mfa");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/auth/widget.test.ts`
Expected: FAIL. The MFA page reports `Widget login: unexpected page 'GARMIN Authentication Application'`, and `flow` is `undefined` on mobile states.

- [ ] **Step 3: Implement**

In `src/auth/widget.ts`, add `import type { SerializedCookie } from "../http/cookie-jar.js";` and then:

```ts
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
```

Change `widgetLogin`'s return type to `Promise<WidgetLoginResult>`. Insert the MFA branch after the restricted-account check and before `if (title !== "Success")`:

```ts
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
```

`fetcher.lastUrl` is the POST's own URL at this point, because `requestMfaCode` has not run yet.

Append `widgetResume`:

```ts
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
  });
  const html = await res.text();
  const title = titleFrom(html);
  if (title !== "Success") throw new GarminAuthError(`SSO error: INVALID_MFA_CODE: ${title}`);
  const ticket = ticketFrom(html);
  if (!ticket) throw new GarminAuthError("Widget login: missing service ticket");
  return complete(ticket, urls.embed);
}
```

In `src/auth/sso.ts`:

1. Import: `import { widgetLogin, widgetResume, type WidgetMfaState } from "./widget.js";`
2. Replace the `MfaState` interface:

```ts
/** Mobile-route MFA state. `flow` is absent on states saved by 0.1.0; absent means mobile. */
export interface MobileMfaState {
  flow?: "mobile";
  loginParams: LoginParams;
  mfaMethod: string;
  cookies: SerializedCookie[];
  domain: string;
}

export type MfaState = MobileMfaState | WidgetMfaState;
```

3. In `login()`'s mobile MFA branch, add `flow: "mobile",` as the first property of `mfaState`.
4. Replace the start of `resumeLogin` so a widget state goes to `widgetResume`:

```ts
export async function resumeLogin(
  mfaState: MfaState,
  code: string,
  options: { fetcher?: Fetcher } = {},
): Promise<{ state: "success"; oauth1: OAuth1Token; oauth2: OAuth2Token }> {
  const fetcher = options.fetcher ?? new Fetcher();
  const ctx: SsoContext = { fetcher, domain: mfaState.domain };
  if (mfaState.flow === "widget") {
    return widgetResume(mfaState, code, fetcher, (ticket, loginUrl) =>
      completeLogin(ticket, ctx, loginUrl),
    );
  }
  fetcher.jar.mergeFromJSON(mfaState.cookies);
  // …the rest of the existing mobile verifyCode body, unchanged…
```

Delete the original `const ctx` line further down, since `ctx` is now declared above.

5. Existing tests that read `loginParams` must narrow first:
   - In `tests/auth/sso-mfa.test.ts`, replace line 25's `expect(result.mfaState.loginParams.clientId).toBe("GCM_ANDROID_DARK");` with:

```ts
    if (result.mfaState.flow === "widget") throw new Error("expected a mobile state");
    expect(result.mfaState.loginParams.clientId).toBe("GCM_ANDROID_DARK");
```

   - In `tests/auth/sso.test.ts` (block 5d), insert `if (result.mfaState.flow === "widget") throw new Error("expected a mobile state");` before `expect(result.mfaState.loginParams).toMatchObject({`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/auth && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/auth/sso.ts src/auth/widget.ts tests/auth/widget.test.ts tests/auth/sso.test.ts tests/auth/sso-mfa.test.ts
git commit -m "feat: verification-code step for the SSO widget sign-in

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `loginDelayMs` on `GarminClient` and type exports

**Files:**
- Modify: `src/client.ts`, `src/index.ts`
- Test: `tests/client.test.ts` (append)

**Interfaces:**
- Consumes: `SsoContext.loginDelayMs` (Task 2), `MobileMfaState` / `WidgetMfaState` (Task 3).
- Produces: `GarminClientOptions.loginDelayMs?: number`. Package exports `MobileMfaState` and `WidgetMfaState` types.

- [ ] **Step 1: Write the failing test**

Append to `tests/client.test.ts`. Add `import { makeSsoServer } from "./helpers/sso-server.js";` and `import type { MobileMfaState, WidgetMfaState } from "../src/index.js";` at the top.

```ts
describe("login falls back to the SSO widget", () => {
  it("honours loginDelayMs and persists the widget sign-in's tokens", async () => {
    resetConsumerCache();
    const harness = makeSsoServer({ loginOutcome: "rate_limited" });
    harness.server.listen({ onUnhandledRequest: "error" });
    try {
      const store = new MemoryTokenStore();
      const client = new GarminClient({ tokenStore: store, loginDelayMs: 0 });
      const started = Date.now();
      const result = await client.login("a@b.test", "pw");
      expect(Date.now() - started).toBeLessThan(2000);
      expect(result.state).toBe("success");
      expect((await store.load())?.oauth1.oauth_token).toBe("o1tok");
      expect(harness.calls).toContain("widget-signin");
    } finally {
      harness.server.close();
    }
  });

  it("exports both MfaState shapes", () => {
    const mobile: MobileMfaState = {
      flow: "mobile",
      loginParams: { clientId: "c", locale: "en-US", service: "s" },
      mfaMethod: "sms",
      cookies: [],
      domain: "garmin.com",
    };
    const widget: WidgetMfaState = {
      flow: "widget",
      mfaMethod: "email",
      csrf: "x",
      signinParams: {},
      referer: "r",
      cookies: [],
      domain: "garmin.com",
    };
    expect([mobile.flow, widget.flow]).toEqual(["mobile", "widget"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/client.test.ts && npx tsc --noEmit`
Expected: FAIL. `tsc` reports that `loginDelayMs` does not exist in type `GarminClientOptions` and that `MobileMfaState` / `WidgetMfaState` are not exported. The vitest run may take ≥3 s because the default delay applies.

- [ ] **Step 3: Implement**

`src/client.ts`:

```ts
export interface GarminClientOptions {
  tokenStore?: TokenStore;
  isCn?: boolean;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  fetchImpl?: typeof fetch;
  /**
   * Pause before the SSO widget's credential POST (the fallback when the mobile login is rate
   * limited), in ms. Default: random 3000–8000. Tests pass 0.
   */
  loginDelayMs?: number;
}
```

Add a field `readonly #loginDelayMs: number | undefined;`, set `this.#loginDelayMs = options.loginDelayMs;` in the constructor, and change the getter:

```ts
  get #ssoContext(): SsoContext {
    return { fetcher: this.#fetcher, domain: this.domain, loginDelayMs: this.#loginDelayMs };
  }
```

`src/index.ts`: change `export type { LoginResult, MfaState } from "./auth/sso.js";` to

```ts
export type { LoginResult, MfaState, MobileMfaState } from "./auth/sso.js";
export type { WidgetMfaState } from "./auth/widget.js";
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/client.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts src/index.ts tests/client.test.ts
git commit -m "feat: loginDelayMs option and exported MfaState shapes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Docs and the 0.3.0 release

**Files:**
- Modify: `README.md`, `AGENTS.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`

- [ ] **Step 1: README**

- In the "Client options" table, add a row after `fetchImpl`:

```markdown
| `loginDelayMs` | random 3000–8000 | Pause before the SSO widget's credential POST, used only when the mobile login is rate limited (see [Authentication](#-authentication)). Set `0` in tests. |
```

- In "🔐 Authentication", after the first paragraph ("Login follows Garmin's SSO flow…"), add:

```markdown
- **Rate-limited sign-in.** Garmin rate limits the mobile sign-in step (`/mobile/api/login`),
  per client id and source IP, often after one or two sign-ins. When that step answers 429,
  `login()` signs in once more through Garmin's SSO web widget (`/sso/embed` + `/sso/signin`),
  which sends no client id, and returns the same tokens. If the widget is rate limited too,
  `GarminRateLimitError` names the widget URL. Tokens refresh for about 30 days without signing
  in, so keep them in a `TokenStore` rather than signing in again.
```

- In "MFA across two HTTP requests", after the paragraph that starts "Treat `mfaState` as a short-lived secret", add:

```markdown
`mfaState.flow` says which sign-in route produced it: `"mobile"` (the default; states saved by
0.1.0 have no `flow` and count as mobile) or `"widget"`. A widget state also holds the page's
CSRF token and form parameters. Pass either kind straight back to `resumeLogin`; read
`loginParams` only after checking `flow !== "widget"`.
```

- [ ] **Step 2: AGENTS.md §5**

After the paragraph that ends "delete it the moment `resumeLogin` returns (…keep the two in step).", add:

```markdown
**Widget fallback.** `login()` first uses the mobile JSON API. Only when that credentials step is
rate limited (HTTP 429, or a 200 body with `error["status-code"] === "429"`) does it sign in once
through the SSO web widget, with a fresh cookie jar and a 3–8 s pause
(`GarminClientOptions.loginDelayMs`). A 429 after the password was accepted
(`preauthorized`, `exchange`) never falls back. Widget rejections keep the `SSO error:` prefix
(`INVALID_CREDENTIALS`, `ACCOUNT_RESTRICTED`, `INVALID_MFA_CODE`). `MfaState` is a union on
`flow` (`"mobile"`, absent = mobile, or `"widget"`); narrow before reading `loginParams`. Widget
tickets are exchanged with `login-url=https://sso.<domain>/sso/embed`.
```

- [ ] **Step 3: CHANGELOG and version**

In `CHANGELOG.md`, under `## [Unreleased]`, insert:

```markdown
## [0.3.0] — 2026-09-24

### Added

- **Widget sign-in fallback.** When Garmin rate limits the mobile SSO login (HTTP 429 on
  `/mobile/api/login`), `login()` signs in through the SSO web widget instead and returns the same
  tokens. The verification-code step works on this path too. New option
  `GarminClientOptions.loginDelayMs` (pause before the widget's credential POST; default 3–8 s).

### Changed

- `MfaState` is now a union on `flow` (`"mobile"` or `"widget"`); mobile states carry
  `flow: "mobile"`, and states without `flow` still resume as mobile. TypeScript code that reads
  `mfaState.loginParams` must check `flow` first. New exported types `MobileMfaState` and
  `WidgetMfaState`.
```

Run: `npm version 0.3.0 --no-git-tag-version`
Expected: `package.json` and `package-lock.json` show `0.3.0`.

- [ ] **Step 4: Full check**

Run: `npm run check`
Expected: typecheck, lint, build and all tests pass. If `docs:api`-generated pages or `tests/api-docs.test.ts` complain about the new option or types, run `npm run docs:api` and include the regenerated files.

- [ ] **Step 5: Commit**

```bash
git add README.md AGENTS.md CHANGELOG.md package.json package-lock.json docs
git commit -m "docs: widget sign-in fallback; release 0.3.0

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Hand-off (user, not the implementer)**

Do not tag, push or publish. The user decides when to push `v0.3.0`, which triggers the npm publish workflow, and runs the live check:

- `npm run login:real` while the account is blocked on the mobile route
- then `npm run smoke:real`
