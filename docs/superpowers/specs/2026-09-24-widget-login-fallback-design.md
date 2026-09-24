# Login: fall back to the SSO web widget when the mobile login is rate limited

Date: 2026-09-24

## Problem

`client.login()` signs in through Garmin's mobile SSO JSON API: `POST /mobile/api/login` with
`clientId=GCM_ANDROID_DARK`. Garmin has rate limited that step (HTTP 429) since March 2026.
Reports say the block is keyed on client id plus account, lasts a day or more, and survives
changing IP or headers:

- python-garminconnect [#337](https://github.com/cyberjunky/python-garminconnect/issues/337) and
  [#344](https://github.com/cyberjunky/python-garminconnect/issues/344)
- garth [#217](https://github.com/matin/garth/issues/217)

Observed on 2026-09-24 by the IronFit app, which uses this library:

- One account signed in twice from a home connection through the mobile route. Both worked.
- A third sign-in, from IronFit's server, got
  `429 Rate limited by Garmin at https://sso.garmin.com/mobile/api/login`.
- The OAuth1 `preauthorized` step and the OAuth2 exchange were never reached, and the same steps
  had worked hours earlier.

The SSO **web widget** (`/sso/embed` + `/sso/signin`) sends no `clientId`, so it sits outside
that bucket. python-garminconnect 0.3.15 keeps it as a login strategy ("widget+cffi") for that
reason. #344 reports it signing in accounts that were blocked on the mobile route. It is also the
flow garth originally used, and its service ticket works with the OAuth1 `preauthorized` exchange
this library already performs.

Counter-evidence: florianpasteur/garmin-connect moved off the widget in June 2026, saying it "no
longer reliably issues tickets". Its widget code kept no cookies between requests and had no MFA
support, so that may have been its own bug. We only find out on a live sign-in.

## Goal

When the mobile login step is rate limited, `login()` signs in through the widget instead, in the
same call. The caller gets the same result shape and the same `Tokens`. Code-step (MFA) accounts
work on the widget path too, through the existing serialisable `MfaState` / `resumeLogin` pattern.

## Non-goals

- No change to the token model. Tokens stay the OAuth1 + OAuth2 pair, stores stay compatible,
  and refresh is unchanged.
- No DI tokens (`diauth.garmin.com`) and no iOS client id. That is the next step if the widget
  also fails, and it would be a breaking change.
- No TLS fingerprint impersonation. The library stays dependency-free, and Node's `fetch` has its
  own fingerprint. If Cloudflare challenges the widget pages from Node, the fallback fails with an
  error that says so; see Risks.
- No strategy configuration API (for example, choosing the widget first). YAGNI until the live
  test shows it is needed.

## Design

### When the fallback runs

`login()` runs the mobile flow exactly as today. It switches to the widget only when the mobile
credentials step is **rate limited**, meaning either:

- `POST /mobile/api/login` answers HTTP 429 (the fetcher raises `GarminRateLimitError`), or
- it answers 200 with a JSON body whose `error["status-code"]` is `"429"`. Python handles this
  form too.

Anything else from the mobile route behaves as it does today and does **not** fall back:

- success, `MFA_REQUIRED`, and a rejected password (`SSO error: …`)
- a 403, a non-JSON challenge page, network errors

A rejected password must not be tried a second time on another route. Treating a Cloudflare
challenge as a fallback trigger is left out until evidence says it helps.

A rate limit on the seed `GET /mobile/sso/en/sign-in` counts the same as one on the login POST.

If the widget flow is rate limited too, `login()` throws a `GarminRateLimitError` whose message
names the widget URL that refused it. The URL makes it clear that both routes were tried.

### Widget flow (`src/auth/widget.ts`, new)

Constants (domain-aware like the rest of `sso.ts`):

- `SSO_BASE = https://sso.<domain>/sso`
- `EMBED = <SSO_BASE>/embed`
- `embedParams = { id: "gauth-widget", embedWidget: "true", gauthHost: SSO_BASE }`
- `signinParams = { ...embedParams, gauthHost: EMBED, service: EMBED, source: EMBED,
  redirectAfterAccountLoginUrl: EMBED, redirectAfterAccountCreationUrl: EMBED }`

The flow uses a fresh `Fetcher` jar, so no mobile-route cookies leak in:

1. `GET EMBED?embedParams` with the browser page headers (`SSO_PAGE_HEADERS`). This sets the
   session cookies.
2. `GET <SSO_BASE>/signin?signinParams` with `Referer: EMBED`. Read `_csrf` from the HTML with
   `name="_csrf"\s+value="(.+?)"`. If it is missing, throw
   `GarminConnectionError("Widget login: missing CSRF token")`.
3. Wait a random delay (default 3–8 s, as in the Python library, to avoid looking like a bot).
   `GarminClientOptions.loginDelayMs?: number` overrides it, and tests pass `0`.
4. `POST <SSO_BASE>/signin?signinParams`, form-urlencoded:
   `username`, `password`, `embed=true`, `_csrf`. `Referer` is the signin URL from step 2.
   Not retried automatically.
5. Classify the response by its `<title>` (case-insensitive):

| Page | Result |
|---|---|
| Title contains "bad gateway", "service unavailable", "cloudflare", "502" or "503" | `GarminConnectionError("Widget login: server error '<title>'")` |
| Title contains "locked", "invalid", "incorrect" or "account error" | `GarminAuthError("SSO error: INVALID_CREDENTIALS: <title>")`. The `SSO error:` prefix keeps consumers that treat that prefix as "the password was rejected" working unchanged. |
| Title contains "unable to sign in" or "unable to login" (child/family accounts) | `GarminAuthError("SSO error: ACCOUNT_RESTRICTED: <title>")` |
| An MFA page: title contains "mfa", or the page declares an inline `var mfaMethod = "…"` | Return `mfa_required` (next section) |
| Title is exactly "Success" | Read the ticket with `\?ticket=(ST-[^"&\s]+)`. If it is missing, throw `GarminAuthError("Widget login: missing service ticket")`. |
| Anything else | `GarminConnectionError("Widget login: unexpected page '<title>'")` |

6. The ticket completes the login through the existing `completeLogin`, with the widget's
   `login-url` (next paragraph). The result is the same `{ state: "success", oauth1, oauth2 }`.

`getOauth1Token(ticket, ctx, loginUrl)` gets a `loginUrl` parameter. The mobile path passes
`https://mobile.integration.<domain>/gcm/android` as today. The widget path passes `EMBED`, which
is what garth sent for widget tickets. The OAuth2 exchange is unchanged.

### Code step (MFA) on the widget path

`MfaState` gains a discriminator. Every field below is plain JSON, so it still crosses an HTTP
boundary:

```ts
type MfaState =
  | { flow?: "mobile"; loginParams; mfaMethod; cookies; domain }        // today's shape
  | { flow: "widget"; mfaMethod: string; csrf: string; signinParams: Record<string, string>;
      referer: string; cookies: SerializedCookie[]; domain: string };
```

A missing `flow` means `"mobile"`, so an `MfaState` saved by 0.1.0 still resumes.

When the widget flow detects an MFA page, it reads the inline variables `customerGuid`,
`mfaMethod`, `locale`, `clientId` and `codeSentTo` (`var <name> = "<value>";`). If `mfaMethod` is
`email` or `sms` and `codeSentTo` is empty, it asks Garmin to send the code, the way the page's own
"Request a new code" link does:

- `POST <SSO_BASE>/verifyMFA/mfaCode?clientId=<clientId>`, JSON `{ customerGuid, mfaMethod, locale }`
- A 429 there is a `GarminRateLimitError`; any other non-2xx is a `GarminConnectionError`.

It then returns `{ state: "mfa_required", mfaState }`, where `mfaState.csrf` is the `_csrf` from
the MFA page and `referer` is that page's URL.

`resumeLogin(mfaState, code)` with `flow: "widget"`:

1. Merge `mfaState.cookies` into the fetcher's jar, as the mobile path does.
2. `POST <SSO_BASE>/verifyMFA/loginEnterMfaCode?signinParams`, form-urlencoded:
   `mfa-code`, `embed=true`, `_csrf`, `fromPage=setupEnterMfaCode`. `Referer` is
   `mfaState.referer`.
3. If the title is "Success", read the ticket and `completeLogin` with the widget `login-url`.
4. Any other title means `GarminAuthError("SSO error: INVALID_MFA_CODE: <title>")`.

Known limitation: after a wrong code, Garmin's page may issue a new `_csrf`. Retrying with the same
`MfaState` could then fail as another wrong code. python-garminconnect behaves the same way. If
the live test shows it matters, `resumeLogin` could return a fresh `MfaState` on a wrong code, but
that is an API change and is not part of this design.

### Where the code goes

- `src/auth/widget.ts` (new): `widgetLogin(email, password, ctx, delayMs)`, `widgetResume(state,
  code, ctx)`, and the HTML helpers (`csrfFrom`, `titleFrom`, `ticketFrom`, `mfaVarsFrom`). These
  are pure functions over strings, so they get their own unit tests.
- `src/auth/sso.ts`:
  - `login()` catches the rate-limit case described above and calls `widgetLogin`.
  - `resumeLogin()` sends `flow: "widget"` states to `widgetResume`.
  - `getOauth1Token` takes the `loginUrl` parameter.
  - The `MfaState` type is extended.
- `src/client.ts`: `GarminClientOptions.loginDelayMs` is passed through to the SSO context. The
  `login` / `resumeLogin` signatures are unchanged.
- `src/index.ts`: export the widened `MfaState` type (the name is unchanged).

### Tests (msw, like `tests/helpers/sso-server.ts`)

The fake SSO server gets widget handlers (`/sso/embed`, `/sso/signin` GET and POST,
`/sso/verifyMFA/mfaCode`, `/sso/verifyMFA/loginEnterMfaCode`) serving small recorded-shape HTML
pages. It also gets a `mobileLoginOutcome: "rate_limited" | "rate_limited_json"` option. Cases:

1. Mobile answers 429:
   - the widget signs in and returns the same tokens
   - `preauthorized` was called with `login-url=https://sso.garmin.com/sso/embed`
   - the POST was form-encoded with `username`, `password`, `embed`, `_csrf` from the signin page
   - cookies from the embed GET were sent on the POST
2. Mobile answers 200 with `{ error: { "status-code": "429" } }`: falls back the same way.
3. Mobile rejects the password: no widget requests at all.
4. Mobile answers 403 or a non-JSON page: no fallback; today's error is unchanged.
5. The widget rejects the password: `GarminAuthError` whose message starts with `SSO error:`.
6. The widget signin POST answers 429: `GarminRateLimitError` naming `/sso/signin`.
7. The widget MFA page:
   - with an empty `codeSentTo`, the explicit `mfaCode` request is sent
   - the returned `mfaState.flow` is `"widget"`, and the state survives `JSON.parse(JSON.stringify())`
   - `resumeLogin` with the right code signs in; a wrong code throws `SSO error: INVALID_MFA_CODE`
   - when `codeSentTo` is present, no `mfaCode` request is made
8. A mobile `MfaState` without `flow` (the 0.1.0 shape) still resumes through `/mobile/api/mfa/verifyCode`.
9. Missing `_csrf` gives `GarminConnectionError`; a "Success" page without a ticket gives `GarminAuthError`.
10. `loginDelayMs: 0` makes no real wait; the default delay is in [3000, 8000] (unit test of the helper).
11. HTML helper unit tests: title, csrf, ticket and MFA variables, including absent values.

`npm run check` (typecheck, lint, build, tests) must pass.

### Live verification (manual, by the user)

On an account currently rate limited on the mobile route: `npm run login:real` should succeed
through the widget and write tokens. Then `npm run smoke:real` should pass with those tokens. If
the widget answers 403 or a challenge page, record the response and stop. That is the TLS
fingerprint risk; the next step is then the DI-token design, not more widget work.

### Docs and release

- `AGENTS.md` §5 (auth model) and `README.md`: describe the fallback, the `flow` field on
  `MfaState`, `loginDelayMs`, and that a widget-path `MfaState` is the same kind of short-lived
  secret.
- `CHANGELOG.md`: `0.2.0`, "login falls back to the SSO web widget when the mobile login is rate
  limited". Minor bump: the new `MfaState` variant and the new option; nothing removed.
- IronFit then only runs `npm i garminconnect-js@^0.2.0`. Its classification ("SSO error:" means
  the password or code was rejected) already fits the widget errors above.

## Risks

- **Cloudflare TLS fingerprinting.** The Python library runs the widget flow only through
  `curl_cffi` browser impersonation. Node cannot do that without a dependency. If Garmin
  challenges Node on `/sso/signin`, this design does not help. We only learn that live.
- **HTML scraping is brittle.** A changed title or markup breaks the widget path. It is a
  fallback, and failures surface as `GarminConnectionError` with the page title, not as a wrong
  password.
- **The per-account block may cover the widget too**, if Garmin widens it. The fallback then
  fails with a 429 naming `/sso/signin`.
