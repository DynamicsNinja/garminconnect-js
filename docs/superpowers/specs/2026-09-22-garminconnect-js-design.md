# garminconnect-js — Design

Date: 2026-09-22
Status: Approved, ready for implementation planning

## Purpose

A TypeScript port of [python-garminconnect](https://github.com/cyberjunky/python-garminconnect)
and its auth dependency [garth](https://github.com/matin/garth), usable from Next.js
server code (route handlers, server actions, server components).

Today the only practical way to read Garmin Connect data from JS is to shell out to
Python or to hand-maintain the SSO flow inline. This library removes that: full
endpoint parity with python-garminconnect, a self-contained SSO login, and token
persistence that survives a stateless serverless process.

## Success criteria

1. A Next.js route handler can fetch any Garmin Connect metric with stored tokens and
   no Python anywhere in the stack.
2. Email/password login works end to end, including MFA, with the MFA code arriving in
   a **separate HTTP request** from the one that started the login.
3. OAuth2 refresh happens automatically and invisibly; a caller never thinks about it.
4. Full method parity with python-garminconnect.
5. Zero runtime dependencies.

## Constraints

- **Node runtime only.** `node:crypto` HMAC-SHA1 and `Buffer` rule out the Edge runtime.
  Documented; the README shows `export const runtime = "nodejs"`.
- **Server only.** Credentials and tokens must never reach the browser. No client-side
  exports, no React hooks.
- **No official API.** Garmin Connect is a private API reached via mobile-app OAuth
  credentials. It can break without notice. The design isolates that risk in one module.
- Node >= 18 (native `fetch`, `FormData`, `Blob`).

## Architecture

Two layers in one package, mirroring the upstream split so that upstream fixes port
one-to-one:

- **Auth + transport layer** (the `garth` equivalent) — SSO login, OAuth1 signing,
  cookie jar, token refresh, token persistence.
- **Endpoint layer** (the `python-garminconnect` equivalent) — ~155 thin typed methods
  over a single `connectapi(path)` primitive.

The boundary is a hard interface, so the auth layer can be split into its own package
later without touching the endpoint layer.

```
src/
  index.ts              public exports
  errors.ts             error hierarchy
  http/
    cookie-jar.ts       minimal RFC6265 jar (domain/path/expiry), no deps
    fetcher.ts          fetch wrapper: cookies, retries, timeout, referer
  auth/
    oauth1.ts           HMAC-SHA1 signing via node:crypto
    consumer.ts         fetch + cache oauth_consumer.json
    sso.ts              login / resumeLogin / getOauth1Token / exchange
    tokens.ts           OAuth1Token, OAuth2Token, expiry helpers
    token-store.ts      TokenStore interface + MemoryTokenStore + FileTokenStore
  client.ts             GarminClient: connectapi/download/upload + auto-refresh
  garmin.ts             Garmin: composes per-service endpoint mixins
  services/             one file per Garmin service (activities, wellness, weight, ...)
  types/                response interfaces, split by service
tests/
  fixtures/             scrubbed recorded responses
```

## The SSO flow

Ported from `garth/src/garth/sso.py` (verified against `main`, 2026-09-22).

Constants:

- `CLIENT_ID = "GCM_ANDROID_DARK"`
- `OAUTH_CONSUMER_URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json"`
- OAuth requests use `User-Agent: com.garmin.android.apps.connectmobile`
- API requests use `User-Agent: GCM-iOS-5.22.1.4`
- SSO page requests use a browser-like iPhone Safari UA plus `Accept`,
  `Accept-Language`, `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document`.
  This is not cosmetic — without it Cloudflare challenges the request.

Domain is `garmin.com`, or `garmin.cn` when the China flag is set. Subdomains used:
`sso`, `connectapi`, `mobile.integration`.

Steps:

1. `GET https://sso.<domain>/mobile/sso/en/sign-in?clientId=GCM_ANDROID_DARK`
   with `Sec-Fetch-Site: none`. Seeds cookies. Response body unused.
2. `POST https://sso.<domain>/mobile/api/login` with query params
   `{clientId, locale: "en-US", service: "https://mobile.integration.<domain>/gcm/android"}`
   and JSON body `{username, password, rememberMe: false, captchaToken: ""}`.
   Read `responseStatus.type`:
   - `SUCCESSFUL` → `serviceTicketId`, go to step 4.
   - `MFA_REQUIRED` → read `customerMfaInfo.mfaLastMethodUsed` (default `"email"`),
     go to step 3.
   - anything else → `GarminAuthError` carrying `type: message`.
3. `POST https://sso.<domain>/mobile/api/mfa/verifyCode` with the same query params
   and JSON body
   `{mfaMethod, mfaVerificationCode, rememberMyBrowser: false, reconsentList: [], mfaSetup: false}`
   → `serviceTicketId`.
4. Best-effort `GET https://sso.<domain>/portal/sso/embed` with
   `Sec-Fetch-Site: same-origin` and a `referer` header set to the previous response
   URL. Sets a Cloudflare load-balancer cookie for backend pinning. Failures here are
   swallowed.
5. `GET https://connectapi.<domain>/oauth-service/oauth/preauthorized?ticket=<ticket>&login-url=https://mobile.integration.<domain>/gcm/android&accepts-mfa-tokens=true`,
   **OAuth1-signed** with the consumer key/secret and no token. Response is
   `application/x-www-form-urlencoded`; parse into
   `{oauth_token, oauth_token_secret, mfa_token?, mfa_expiration_timestamp?}`.
6. `POST https://connectapi.<domain>/oauth-service/oauth/exchange/user/2.0`,
   OAuth1-signed with consumer credentials **and** the oauth1 token/secret.
   Content-Type `application/x-www-form-urlencoded`. Body carries
   `audience=GARMIN_CONNECT_MOBILE_ANDROID_DI` on initial login (omitted on refresh)
   and `mfa_token` when present. Response JSON is the OAuth2 token; compute
   `expires_at = now + expires_in` and
   `refresh_token_expires_at = now + refresh_token_expires_in`.

Step 6 alone, with the stored oauth1 token, is also the refresh operation.

## OAuth1 signing (`auth/oauth1.ts`)

The only cryptographic code in the library. Pure functions, no I/O:

- RFC3986 percent-encoding (unreserved set `A-Za-z0-9-._~`; note `encodeURIComponent`
  does not escape the four characters `! * ' ( )`, which must be escaped manually).
- Signature base string: `METHOD&encode(base_url)&encode(sorted_normalized_params)`,
  where params are the union of query params and OAuth params, sorted by encoded key
  then encoded value.
- Signing key: `encode(consumerSecret)&encode(tokenSecret ?? "")`.
- HMAC-SHA1 via `crypto.createHmac`, base64 output.
- Emits `Authorization: OAuth oauth_consumer_key="...", oauth_nonce="...", ...`.

Verified against the RFC5849 §1.2 and §3.4.1.1 reference vectors in unit tests, so a
signing bug is caught without network access.

## Cookie jar (`http/cookie-jar.ts`)

`fetch` discards `Set-Cookie` between calls, and steps 1–4 depend on cookies carrying
forward. A minimal jar: parse `Set-Cookie`, store name/value/domain/path/expires/secure,
match on domain suffix and path prefix, drop expired entries, serialize to a `Cookie`
header.

Scoped per client instance — never a module global — so concurrent users in one Node
process cannot see each other's session. The jar is JSON-serializable, which is what
makes cross-request MFA resume possible.

## MFA across requests (deliberate divergence from garth)

garth's `resume_login` takes a live client object held in memory. In a serverless
deployment the MFA code arrives in a second HTTP request, likely on a different
instance, so an in-memory handle is unusable.

`login()` therefore returns a discriminated union:

```ts
type LoginResult =
  | { state: "success"; oauth1: OAuth1Token; oauth2: OAuth2Token }
  | { state: "mfa_required"; mfaState: MfaState };

interface MfaState {
  loginParams: { clientId: string; locale: string; service: string };
  mfaMethod: string;
  cookies: SerializedCookie[];
  domain: string;
}
```

`MfaState` is plain JSON. Callers persist it (encrypted session, Redis) and later call
`resumeLogin(mfaState, code)` from any process. `MfaState` contains no password and no
long-lived secret; it is session-scoped and should be treated as sensitive and
short-lived. Documented as such.

## Token persistence

```ts
interface Tokens { oauth1: OAuth1Token; oauth2: OAuth2Token }

interface TokenStore {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}
```

Shipped implementations:

- `MemoryTokenStore` — tests and single-process scripts.
- `FileTokenStore(dir)` — writes `oauth1_token.json` and `oauth2_token.json` in
  garth's exact on-disk shape, so tokens produced by Python `garth` load directly and
  vice versa. Written with mode `0600`.

Everything else (Redis, Postgres, encrypted cookie) is the consuming app's business.

Refresh is lazy: before each authenticated call, if `oauth2.expires_at` is in the past
(with a 60-second safety margin), run the exchange and `save()`. If the OAuth1 token is
itself expired or the exchange returns 401, clear it and throw `GarminAuthError` — a
full re-login is required, and the library never silently prompts for credentials.

Concurrent refresh is deduplicated within a client instance by caching the in-flight
promise, so ten parallel calls trigger one exchange rather than ten.

## Transport (`http/fetcher.ts`, `client.ts`)

`fetcher` wraps `fetch` with: the cookie jar, a configurable timeout via `AbortSignal`
(default 10s), retries with exponential backoff on 408/500/502/503/504 and network
errors (3 attempts, 0.5s backoff factor — garth's defaults), and optional `referer`
propagation from the previous response.

`GarminClient` adds auth and shape:

- `connectapi(path, {method, params, body, headers})` — injects the bearer token,
  refreshes if needed, returns `null` on 204 and parsed JSON otherwise.
- `download(path)` — same, returns a `Buffer` (FIT/TCX/GPX/CSV exports).
- `upload(file, path = "/upload-service/upload")` — multipart via native `FormData`
  and `Blob`.

## Endpoint layer

`Garmin` composes per-service mixins so no file grows unwieldy; one file per Garmin
service under `src/services/`. Methods are mechanical:

```ts
async getSleepData(cdate: string): Promise<SleepData> {
  return this.client.connectapi(
    `/wellness-service/wellness/dailySleepData/${await this.displayName()}`,
    { params: { date: cdate, nonSleepBufferMinutes: 60 } }
  );
}
```

Methods requiring `displayName` or `userName` resolve them from a lazily cached
`GET /userprofile-service/socialProfile`, matching upstream.

Naming: camelCase (`getSleepData` for `get_sleep_data`). Dates are accepted as
`YYYY-MM-DD` strings or `Date` objects, normalized internally to the string form
Garmin expects.

Response types are hand-written interfaces per service, derived from recorded
fixtures. Where a payload is sprawling and undocumented, the type stays honest —
index signatures and `unknown` rather than invented fields.

## Errors (`errors.ts`)

- `GarminError` — base.
- `GarminAuthError` — 401/403, failed SSO, expired OAuth1.
- `GarminRateLimitError` — 429, carries `retryAfter`.
- `GarminConnectionError` — network failure or timeout.
- `GarminHttpError` — other non-2xx, carries `status`, `url`, and response body.

Retries apply to 408/5xx and network errors only. Never 4xx. Never 429 unless the
server sent `Retry-After`.

## Testing

Vitest with MSW intercepting at the `fetch` layer. TDD: test first, observe the
failure, then implement.

- **Unit** — OAuth1 signing against RFC5849 reference vectors; cookie jar domain/path
  matching and expiry; token expiry math; path and query construction for every
  endpoint method.
- **Flow** — the full SSO sequence against recorded fixtures: success path, MFA path,
  serialize-`MfaState`-and-resume-in-a-fresh-client path, auto-refresh path, expired
  OAuth1 path, concurrent-refresh dedup.
- **Live smoke** — opt-in, skipped unless `GARMIN_EMAIL` and `GARMIN_PASSWORD` are
  present. Never runs in CI.

Fixtures are recorded by a `npm run record` script that scrubs names, emails, user IDs,
tokens, and GPS coordinates before writing. Scrubbing is itself tested.

CI runs typecheck, lint, and the unit + flow tiers on Node 18/20/22.

## Packaging

- TypeScript `strict`, built with `tsup` to dual ESM/CJS with declarations.
- `engines.node >= 18`; `exports` map with types-first ordering.
- Zero runtime dependencies. Dev only: typescript, tsup, vitest, msw, eslint, prettier.
- README covers: one-time login script, `lib/garmin.ts` factory reading from a store,
  a route handler example, the two-request MFA flow, and the `nodejs` runtime caveat.
- MIT, matching both upstream projects. Attribution to python-garminconnect and garth
  in README and NOTICE.

## Out of scope

- Telemetry (garth has it; unnecessary here).
- garth's typed `data`/`stats` resource classes — python-garminconnect does not use them.
- A CLI.
- Any client-side or React surface. Credentials stay on the server.
- Edge runtime support.

## Risks

- **Garmin changes the SSO flow.** Historically it has, more than once. Mitigation: the
  flow lives in one file, mirroring garth's, so upstream's fix ports directly. The live
  smoke test is how you find out.
- **Fixtures drift from reality.** Recorded responses keep passing after Garmin changes
  a payload. Mitigation: the `npm run record` refresh task and the manual live smoke run.
- **Consumer key rotation.** The key comes from a third-party S3 bucket
  (`thegarth.s3.amazonaws.com`) that garth's author controls. If it disappears, login
  breaks. Mitigation: the URL is configurable and the fetched value is cacheable, so a
  consumer can supply their own.

## Appendix — endpoint inventory

Full parity with python-garminconnect. The authoritative list is
`garminconnect/__init__.py` on `master`; the implementation plan enumerates every
method and must be checked against that file at implementation time rather than
against this summary. Services covered:

user summary and stats; steps (daily/weekly); floors; heart rate and resting HR;
intensity minutes; sleep (daily and range); stress and all-day stress; body battery
and body battery events; body composition, weigh-ins, and weight deletion; blood
pressure (get/set/delete); hydration; respiration; SpO2; HRV (daily and range);
max metrics (VO2max), functional threshold power, lactate threshold; training
readiness, training status, endurance score, hill score, running tolerance, race
predictions, fitness age; personal records; badges, adhoc challenges, badge
challenges, virtual challenges; activities (list, search, detail, splits, weather,
HR zones, gear, delete); activity download (FIT/TCX/GPX/CSV) and upload; gear;
workouts; devices, device settings, device last-used, solar data; Connect IQ; goals;
women's health (menstrual cycle calendar, daily log get/set/delete, pregnancy);
lifestyle logging; user profile and social profile.
