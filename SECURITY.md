# Security

## Reporting a vulnerability

Report privately through [GitHub's security advisories][advisories] rather than a public issue.
Please do not open a public issue for anything that could expose someone's Garmin account.

[advisories]: https://github.com/DynamicsNinja/garminconnect-js/security/advisories/new

## What this library handles

It authenticates to Garmin Connect and holds OAuth tokens on your behalf. Three properties of that
are worth knowing before you deploy it.

**It is server-only, and not by convention — by construction.** It uses `node:crypto` and `Buffer`,
so it cannot run on an Edge runtime, and there is no client-side entry point. In a Next.js route
handler you must set `export const runtime = "nodejs"`. Credentials and tokens must never reach the
browser: a raw OAuth2 access token is ~2 KB of bearer credential, and anything in `localStorage`, a
readable cookie, or a Client Component bundle is exposed to any script on the page.

**`MfaState` is a live secret, not inert JSON.** `login()` returns it instead of blocking for a
code, so MFA works across two HTTP requests in a serverless deployment. It contains no password,
but `mfaState.cookies` is a partially-authenticated SSO session: anyone holding it can finish the
login with the code. Encrypt it at rest, scope it to the session that started the login, and delete
it as soon as `resumeLogin` returns.

**A `TokenStore` holds long-lived credentials.** The OAuth1 token stays usable for ~30 days and is
what refreshes the session, so a leaked store is a leaked account until the user changes their
password. `FileTokenStore` writes plain JSON — appropriate for a developer machine, not for a
multi-tenant server. Implement `TokenStore` against your own encrypted storage there.

## Interpolated values are encoded

Every caller-supplied value that reaches a request path goes through `pathSegment()`. Without it, a
raw id is a request-redirection primitive rather than a cosmetic problem: the transport hands the
composed URL to `new URL()`, which normalises `..`, so an id like
`../../weight-service/weight/2026-01-01/byversion/999` would resolve to a DELETE against a
different Garmin service, carrying the user's bearer token. The headline use case for this library
is a route handler receiving `params.id` from the network, so that shape is the default, not an
edge case. If you add a service, route every interpolated id through `pathSegment` too.

## Scope

This library talks to undocumented Garmin Connect endpoints. It is not affiliated with, endorsed by
or supported by Garmin. Endpoints can change or disappear without notice; treat a sudden 4xx as a
possible upstream change rather than assuming your code is wrong.
