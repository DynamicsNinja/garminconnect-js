# Hosted garminconnect-mcp at `garmin.ficdev.xyz/mcp` — design

Date: 2026-10-07. Status: approved; implementation plan docs/superpowers/plans/2026-10-07-hosted-mcp.md

## 1. Intent

**Goal.** A one-stop hosted MCP server for people who do not want to install anything. A user
pastes `https://garmin.ficdev.xyz/mcp` into any MCP client (claude.ai custom connector, which
syncs to Claude mobile and Desktop; Claude Code; other clients), signs in to Garmin once in a
browser window, and gets the same Garmin tools the Desktop Extension has.

**Who.** Anyone with a Garmin account — a public service, not a demo and not single-user.

**Decisions made in conversation.**
- **Public, OAuth-based** (not a static bearer token): it must work as a claude.ai custom connector.
- **Hybrid token model**: Garmin tokens are NEVER stored on the server. They travel inside
  encrypted ("sealed") OAuth tokens that the MCP client holds. The server keeps only a small grant
  table (no tokens, no emails) for revocation, refresh-token reuse detection and usage stats.
- **Code lives in this repo's `mcp/` package** as a second entry point, deployed as its own
  Dokploy application; Traefik routes `/mcp` and the two OAuth `/.well-known` documents on
  `garmin.ficdev.xyz` to it. The Next.js demo at the same host is unchanged.
- `https://garmin.ficdev.xyz/mcp` is the only URL a user ever types.

**Constraints.**
- `garminconnect-js` keeps zero runtime dependencies. One small public addition is allowed
  (§4.4).
- Hosted tools are generated from the same factories as the stdio server; they follow the library
  through the manifest with no hand-maintenance.
- The stdio package and Desktop Extension keep working unchanged (`engines.node >= 18`). The hosted
  entry needs Node 22 (`node:sqlite`), which only the Docker image has to satisfy.
- No new runtime dependencies: Express, `express-rate-limit` and the OAuth router already come
  with `@modelcontextprotocol/sdk` 1.30.1; SQLite is `node:sqlite`.
- Releases still need the maintainer's explicit go-ahead.

**Success criteria.**
1. Adding `https://garmin.ficdev.xyz/mcp` in claude.ai opens a Garmin sign-in window; after
   signing in (MFA included) the Garmin tools are listed and a read tool returns data.
2. The same works from Claude Code via `claude mcp add --transport http garmin https://garmin.ficdev.xyz/mcp`.
3. The connector keeps working past one hour (access-token refresh) and past ~27 h (Garmin
   OAuth2 refresh) without the user signing in again.
4. A database dump reveals no Garmin token, email, password or Garmin data.
5. Replaying an old refresh token revokes that connection.

## 2. Architecture

```
garmin.ficdev.xyz ── Traefik (Dokploy)
   ├─ /mcp…                                   → garminconnect-mcp-http container (new)
   ├─ /.well-known/oauth-protected-resource…  → same container
   ├─ /.well-known/oauth-authorization-server → same container
   └─ everything else                         → Next.js demo (unchanged)
```

Endpoints served by the container:

| Path | Purpose |
|---|---|
| `POST /mcp` (also `GET`/`DELETE` → 405) | Streamable HTTP MCP endpoint, bearer-protected |
| `/.well-known/oauth-protected-resource/mcp` | RFC 9728 resource metadata → names the authorization server |
| `/.well-known/oauth-authorization-server` | RFC 8414 metadata; issuer `https://garmin.ficdev.xyz` |
| `POST /mcp/oauth/register` | RFC 7591 dynamic client registration |
| `GET/POST /mcp/oauth/authorize` | Garmin sign-in page (email/password, then MFA step) |
| `POST /mcp/oauth/token` | `authorization_code` (PKCE S256 required) and `refresh_token` grants |
| `POST /mcp/oauth/revoke` | RFC 7009 revocation |
| `GET /mcp/healthz` | Liveness for Docker/Dokploy |

An unauthenticated `/mcp` request returns `401` with
`WWW-Authenticate: Bearer resource_metadata="https://garmin.ficdev.xyz/.well-known/oauth-protected-resource/mcp"`.

The MCP transport is **stateless**: each `POST /mcp` builds a fresh `Server` (via the existing
`createServer`) and a `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined`, so no
MCP session affinity and no in-memory state between requests.

### 2.1 Units (`mcp/src/http/`)

| File | Responsibility | Depends on |
|---|---|---|
| `seal.ts` | `seal(purpose, payload, ttl?)` / `unseal(purpose, token)`: AES-256-GCM over JSON, base64url, with a purpose tag and optional `exp`. A key ring: the first key seals, every key unseals. Tampering, wrong purpose or expiry → `null`. | `node:crypto` |
| `grants.ts` | `GrantStore` over `node:sqlite`: create, activate (single-use), get, bump generation, revoke one / all-for-user, touch `last_used`, purge stale. | `node:sqlite` |
| `provider.ts` | The SDK's `OAuthServerProvider` + `OAuthRegisteredClientsStore`: sealed client ids, codes, access and refresh tokens; generation checks. | `seal`, `grants`, `garminconnect-js` |
| `signin.ts` | Renders and handles the authorize page: form, MFA step (sealed `mfa` state in a hidden field), "Disconnect my other connections" checkbox; redirects with `code` + `state`. | `provider`, `garminconnect-js` |
| `session.ts` | `tokenSession(tokens)`: a per-request `Session` over a `MemoryTokenStore`. | `garminconnect-js` |
| `app.ts` | Express wiring: SDK `mcpAuthRouter` (metadata, register, token, revoke) + custom authorize, `requireBearerAuth` on `/mcp`, rate limits, `trust proxy`, healthz. Exports `createHttpApp(deps)` for tests. | all above, `../server`, `../tools` |
| `main.ts` | `garminconnect-mcp-http` bin: reads env, opens the DB, starts purge timer, listens. Also `revoke <grant_id>` / `revoke --all` admin subcommands. | `app` |

`mcp/package.json` gains a second bin `garminconnect-mcp-http` → `dist/http.js`; `tsup` gains the
entry. Nothing in the stdio path imports `http/`.

## 3. Tokens

All tokens are `seal(...)` output. `SEAL_KEYS` is a comma-separated list of base64 32-byte keys.
Rotating: prepend a new key, redeploy, drop the old one after the longest-lived token (refresh,
~30 days) has had time to roll. (Superseded, see §11: client ids never expire and are never
re-issued, so old keys stay in `SEAL_KEYS` unless compromised; dropping one disconnects everyone.)

| Token | Sealed payload | TTL | Accepted when |
|---|---|---|---|
| `client_id` | `{redirect_uris, client_name}` | none | `redirect_uri` matches one registered value exactly |
| `mfa` (form field) | `{mfaState, oauth params}` | 10 min | same client and redirect as the original request |
| auth code | `{grant_id, tokens, client_id, redirect_uri, code_challenge}` | 60 s | grant is `pending`; exchange flips it to `active` (single use, DB-enforced); PKCE S256 verifier matches |
| access token | `{grant_id, tokens}` | 1 h | grant exists and is not revoked |
| refresh token | `{grant_id, generation, tokens}` | none (Garmin's refresh expiry decides) | `generation` equals the DB value |

`tokens` is the library's `Tokens` object (OAuth1 + OAuth2). Claude cannot read or alter it.

### 3.1 Grant table

```sql
CREATE TABLE grants (
  grant_id TEXT PRIMARY KEY,          -- random 128-bit, base64url
  garmin_user_hash TEXT NOT NULL,     -- HMAC-SHA256(seal key, Garmin profileId)
  client_name TEXT,                   -- from DCR, for stats ("Claude", "Claude Code")
  state TEXT NOT NULL,                -- 'pending' | 'active' | 'revoked'
  generation INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE INDEX grants_user ON grants (garmin_user_hash);
```

`garmin_user_hash` uses the first `SEAL_KEYS` key as HMAC key; after rotation, "disconnect my other
connections" only matches grants created under the current key. That is accepted.

### 3.2 Flows

**Sign-in.** `GET /mcp/oauth/authorize` validates client/redirect/PKCE params (the SDK handler)
and renders the form. `POST` calls `client.login` on a `GarminClient` with a `MemoryTokenStore`
and the library's widget fallback. On `mfa_required`, it renders the code step carrying a sealed
`mfa` field; `resumeLogin` completes it. On success: `getUserProfile()` → `profileId` → create a
`pending` grant; if the checkbox was ticked, revoke every other grant with the same user hash;
redirect to `redirect_uri?code=…&state=…`. The password is used once and never stored or logged.
Garmin errors are shown on the form in plain words (wrong password, account locked, Garmin rate
limiting).

**Code exchange.** Unseal → check `exp`, client, redirect, PKCE → activate grant (fails if not
`pending`) → issue access + refresh (generation 0).

**Refresh.** Unseal → load grant; revoked or missing → `invalid_grant`. Generation mismatch →
revoke the grant, `invalid_grant` (reuse = theft). Otherwise bump generation, call the new
`client.refreshTokens()` (§4.4) which refreshes the Garmin OAuth2 token only if it is expired or
expiring within 2 h, and issue a new access + refresh carrying the current Garmin tokens. A Garmin
`GarminAuthError` here (OAuth1 dead) revokes the grant → `invalid_grant` → the client prompts the
user to reconnect.

**Tool call.** `requireBearerAuth` → `verifyAccessToken` unseals and checks the grant (one indexed
lookup) and touches `last_used` (at most once a minute per grant). The handler builds
`createServer({ config, session: tokenSession(tokens), files: inlineFiles }, HOSTED_TOOL_FACTORIES)`.
If the library refreshes the Garmin OAuth2 token mid-request, the result lives only in memory; the
next hourly refresh persists it. A `GarminAuthError` from a tool revokes the grant and returns a
tool error: "Your Garmin session has expired. Reconnect the Garmin connector."

**Revocation.** `/mcp/oauth/revoke` (access or refresh token → revoke its grant), the sign-in
checkbox, and `garminconnect-mcp-http revoke <grant_id>|--all` inside the container.

**Housekeeping.** On start and every 24 h: delete grants with `last_used` older than 35 days,
and `pending` grants older than 10 minutes.

## 4. Changes to existing code

### 4.1 `ServerDeps.files` — a files strategy

`method-tools.ts` stops calling `readUpload`/`saveDownload` directly and asks `deps.files`:

```ts
interface FilesStrategy {
  uploadSchema(): { properties: Record<string, object>; required: string[] };
  readUpload(input: Record<string, unknown>): Promise<{ blob: Blob; filename: string }>;
  deliverDownload(name: string, bytes: Uint8Array): Promise<CallToolResult>;
}
```

- `localFiles(downloadDir)` — today's behaviour exactly (`filePath`; save to folder, return path).
- `inlineFiles` — upload takes `filename` (`.fit`/`.gpx`/`.tcx`), `content`, `encoding: "utf8" |
  "base64"`, max 10 MB decoded. Download returns an MCP embedded resource: `text` for
  gpx/tcx/kml/csv/xml/json, base64 `blob` otherwise, MIME type from `sniffExtension`; over 5 MB →
  a tool error naming the size.

The stdio CLI passes `localFiles`; existing tests keep passing unchanged.

### 4.2 Hosted tool list

`HOSTED_TOOL_FACTORIES = [workoutTools, methodTools]` — no `signInTools`. `EXCLUDED`/`OPT_IN` and
`GARMIN_MCP_GROUPS`/`GARMIN_MCP_ENABLE_GRAPHQL` behave as in stdio.

### 4.3 `createServer` auth-error hook

Today a `GarminAuthError` calls `deps.session.reset({ rejected: true })`. `tokenSession`'s `reset`
revokes the grant; the stdio `fileSession` is unchanged. The error text for the hosted case comes
from the session (`Session.authErrorHint?()`), so `errors.ts` stays transport-agnostic.

### 4.4 Library: `GarminClient#refreshTokens()`

```ts
/** Refreshes the OAuth2 token if it is expired or expires within `withinMs` (default 0); returns the current tokens. */
refreshTokens(options?: { withinMs?: number }): Promise<Tokens>;
```

Wraps the private `#ensureFresh` (sharing its concurrent-refresh collapse), persists through the
configured `TokenStore` as today. Not a `Garmin` method, so the manifest is unaffected. Documented
in AGENTS.md §3's `GarminClient` table and the README.

## 5. Abuse and operational limits

`app.set("trust proxy", 1)` when `TRUST_PROXY=1` (Traefik's `X-Forwarded-For`).

| Limit | Value |
|---|---|
| Sign-in POSTs | 5 failed per IP per 15 min; 100 in total per 15 min |
| `/mcp/oauth/token` | 300 per IP per min (claude.ai calls it from Anthropic's shared egress IPs) |
| `/mcp/oauth/register` | 1000 per IP per hour (same reason) |
| `/mcp` | 120 per grant per min |
| Request body | 15 MB on `/mcp` (base64 uploads), 16 KB elsewhere |

**Known risk, not solved here:** every user's Garmin traffic — logins especially — leaves from
one server IP. Garmin rate-limits logins and may flag the address under load. Mitigations in
scope: the sign-in limit above, rolling refresh so users rarely log in again, and plain-language
errors when Garmin returns 429. Multiple egress IPs are out of scope.

Logs: grant id, tool name, status, duration. Never tokens, emails, passwords, Garmin payloads or
query strings.

Security headers on the sign-in page: `Content-Security-Policy: default-src 'none'; style-src
'unsafe-inline'; form-action 'self' <registered redirect origin>`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, `Cache-Control: no-store`.

## 6. Configuration

| Env | Required | Meaning |
|---|---|---|
| `PUBLIC_URL` | yes | `https://garmin.ficdev.xyz`; issuer and every advertised URL derive from it |
| `SEAL_KEYS` | yes | comma-separated base64 32-byte keys (`openssl rand -base64 32`); startup fails on a missing or short key |
| `DB_PATH` | yes | `/data/grants.db` |
| `PORT` | no | default 3000 |
| `TRUST_PROXY` | no | `1` behind Traefik |
| `GARMIN_MCP_GROUPS`, `GARMIN_MCP_ENABLE_GRAPHQL` | no | as in stdio |

## 7. Deployment

- `mcp/Dockerfile`: multi-stage; build stage `node:22-slim` at repo root (`npm ci`, `npm run build
  -w mcp`, because the build inlines `../src`); runtime stage `node:22-slim`, non-root user,
  `VOLUME /data`, `HEALTHCHECK` on `/mcp/healthz`, `CMD ["node", "mcp/dist/http.js"]`.
- Dokploy: new Application from the GitHub repo, build type Dockerfile, path `mcp/Dockerfile`,
  context `.`, volume at `/data`, env from §6. Domains on `garmin.ficdev.xyz`, HTTPS, **Strip path
  off**, container port 3000: path `/mcp`, path `/.well-known/oauth-protected-resource`, path
  `/.well-known/oauth-authorization-server`. Traefik ranks longer rules first, so these win over
  the Next.js app's `/`.
- Auto-deploy **off**. `publish.yml`, on a `vX.Y.Z` tag and after npm publish, POSTs the Dokploy
  deploy webhook (`DOKPLOY_DEPLOY_URL` repository secret; the step is skipped when unset). The
  hosted server ships in lockstep with npm and the `.mcpb`.

## 8. Testing

Mock Garmin at `fetchImpl`, never internals (AGENTS.md §8).

- **Unit**: `seal` (round-trip, tamper, wrong purpose, expiry, key rotation, short key rejected);
  `GrantStore` (single-use activation, generation bump, reuse revokes, revoke-all-for-user, purge);
  `inlineFiles` (schema, utf8/base64, caps, text vs blob resource); hosted tool list (no
  `sign_in_to_garmin`, upload tools take `content`); `localFiles` keeps today's behaviour;
  `GarminClient#refreshTokens` (no-op when fresh, refreshes within window, persists, collapses
  concurrent calls).
- **Integration** (`mcp/tests/http/flow.test.ts`): `createHttpApp` on an ephemeral port with a fake
  Garmin. Drives 401 + metadata discovery → register → authorize GET/POST (and the MFA branch) →
  token with PKCE (and a wrong verifier, a reused code) → `tools/list` → `tools/call` → refresh →
  replaying the previous refresh token revokes → `/mcp` 401; a `GarminAuthError` from a tool
  revokes; the DB file contains no token, email or password bytes.
- **Live**: `npm run smoke:http` — local server, test account only (`GARMIN_TEST_PROFILE_ID`
  gate), full OAuth via the SDK client, one read and one workout create/read-back/delete.
- **Manual acceptance** after deploy: claude.ai custom connector, Claude mobile, Claude Code.
- `npm run check` covers it (`check -w mcp` already runs typecheck/build/tests); a `docker build`
  of `mcp/Dockerfile` runs in CI.

## 9. Docs

- `mcp/README.md`: "Use it without installing" — the URL and per-client steps.
- `mcp/PRIVACY.md`: a hosted section — what the grant row holds, what is never stored, where
  tokens live, how to disconnect.
- `AGENTS.md` §9: the hosted entry, `FilesStrategy`, `HOSTED_TOOL_FACTORIES`; §3: `refreshTokens`.
- Root `README.md`: one line pointing at the hosted URL.

## 10. Out of scope

Multiple egress IPs; an account/dashboard page; `garmin.cn` accounts; MCP resources and prompts;
any change to the Next.js demo (a "Use with Claude" link there is a follow-up in that repo);
scopes finer than "everything the tool list exposes".

## 11. Refinements made while planning

These replace the matching statements above.

1. **No npm bin for the hosted server.** `tests/mcp-package.test.ts` pins `mcp`'s `bin` and `dependencies`. The hosted entry is built to `mcp/dist-http/http.mjs` (everything inlined, like the extension bundle) and run only from the Docker image. Express, `express-rate-limit` and `@types/express` become devDependencies of `mcp`, needed at build time only.
2. **OAuth endpoints are the SDK's individual handlers mounted under `/mcp/oauth/*`.** The SDK's `mcpAuthRouter` resolves every endpoint against the domain root (`new URL("/token", base)`), so it cannot put them under `/mcp`. We mount `authorizationHandler`, `tokenHandler`, `clientRegistrationHandler` and `revocationHandler` ourselves and pass our own metadata to `mcpAuthMetadataRouter`.
3. **The sealed `client_id` carries the whole registration**, including a `client_secret` when a confidential client registers. The SDK's client authentication then works with no storage.
4. **Refresh grace window:** the generation just before the current one is accepted for 60 s after a rotation, without revoking. Two racing refreshes (claude.ai web and mobile, or a client retry) must not disconnect the user.
5. **A tool-call auth error revokes the grant only for a dead Garmin session**, meaning a `GarminAuthError` whose message ends in `(401)` or says "log in again". A 403 is often Cloudflare and is transient, so it does not revoke. `Session.reset` gains an optional `error` to carry this.
6. **Deploys go through the Dokploy API** (`POST /api/application.deploy` with `x-api-key`), not a webhook, because the API is documented. Secrets: `DOKPLOY_URL`, `DOKPLOY_API_KEY`, `DOKPLOY_APPLICATION_ID`.
7. **An extra endpoint, `POST /mcp/oauth/signin`**, receives the sign-in form. `/mcp/oauth/authorize` (the SDK handler) only validates and renders it.
8. **`node:sqlite` is loaded through `createRequire`** (`loadSqlite()` in `grants.ts`) because vite-node cannot import it. SQLite tests skip on Node < 22.13 and run on current Node 22 in CI.
9. **A refresh calls Garmin before rotating the generation**, so a transient Garmin failure leaves the refresh token usable. Section 3.2 said "bump, then refresh".
10. **Request bodies on the SDK OAuth endpoints are capped at 16 KB** by parsers mounted ahead of the SDK handlers.
11. **Registration and token limits are per IP but generous** (1000 registrations per hour, 300 token calls per minute). claude.ai does discovery, registration and token exchange from Anthropic's servers, so the original 10/hour and 30/min would have been global limits for every claude.ai user.
12. **The sign-in page says where the code goes.** Anyone can register a client named "Claude" with any redirect URI, so the page shows the redirect host (or app scheme), calls the client "an app that calls itself NAME", and, for a target outside `TRUSTED_REDIRECTS` (`claude.ai`, `claude.com` over https; loopback; `cursor:`, `vscode:`, `vscode-insiders:`), shows a warning and requires a `confirmRedirect` checkbox, enforced server-side before Garmin is called.
13. **Confidential clients' secrets never expire** (`clientSecretExpirySeconds: 0`): the client id is never re-issued, so a 30-day expiry would strand the client.
14. **Key rotation keeps the old keys.** Client ids are sealed without expiry, so dropping a key from `SEAL_KEYS` invalidates every client registered under it; drop one only if it is compromised.
15. **Hardening from the final review:** the per-IP sign-in limit counts only failures (an MFA page or a redirect is a success), a second limiter caps sign-ins at 100 per 15 minutes overall, a replayed authorization code revokes the grant it activated (RFC 6749 §4.1.2), SQLite waits up to 5 s for a lock (`busy_timeout`), a failed purge is logged rather than fatal, and Garmin's SSO error codes are shown in plain words.
