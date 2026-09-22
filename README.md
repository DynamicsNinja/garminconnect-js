[![Release][release-shield]][release-url]
[![Last Commit][activity-shield]][activity-url]
[![License][license-shield]][license-url]
[![Maintenance][maintenance-shield]][maintenance-url]

# TypeScript: Garmin Connect

A zero-dependency TypeScript port of Python's [`garminconnect`][python-garminconnect-url] (and
its auth dependency, [`garth`][garth-url]) for **Node and Next.js server runtimes**. It talks to
the same undocumented Garmin Connect endpoints the mobile app uses, with a fully typed,
promise-based API.

If you're an AI coding agent (or configuring one), read [`AGENTS.md`](AGENTS.md) first — it's a
terser, higher-signal briefing than this README and calls out what does *not* exist here.

Two files show it working end to end:

- [`scripts/login.ts`](scripts/login.ts) — one-time interactive login. Prompts for an MFA code on
  stdin if Garmin asks for one, then writes tokens to `./tokens`.
- [`examples/demo.ts`](examples/demo.ts) — an interactive, numbered-menu demo (`npm run demo`)
  that loads those tokens and walks through the categories this library implements: profile,
  daily health, activities, body composition, and a JSON export.

## 📟 See it run

```text
$ npm run login
MFA code (sent via email):
Tokens written to ./tokens

$ npm run demo

garminconnect-js demo
=====================
1) User & Profile
2) Daily Health
3) Activities
4) Body Composition
5) Export all to JSON
0) Exit
> 1

--- User & Profile ---
Display name : jdoe-display
Full name    : Jamie Doe
Profile ID   : 1234567
Unit system  : metric

garminconnect-js demo
=====================
1) User & Profile
2) Daily Health
3) Activities
4) Body Composition
5) Export all to JSON
0) Exit
> 2

--- Daily Health (2026-09-21) ---
Steps: 8742  Distance: 6.3 km  Active kcal: 512
Resting HR: 58 bpm  Min/Max: 54/142 bpm
Sleep data: available
HRV: available
Body Battery entries: 24

garminconnect-js demo
=====================
1) User & Profile
2) Daily Health
3) Activities
4) Body Composition
5) Export all to JSON
0) Exit
> 0
Goodbye.
```

(Numbers above are synthetic — a demo fixture, not a real account.)

## 📊 API coverage

python-garminconnect exposes 154+ methods across 14 categories. This port is younger and
**does not claim parity** — here is exactly what exists today, honestly counted.

### Implemented and verified against a live Garmin account (14 methods)

| Category | Methods |
|---|---|
| User & Profile (2) | `getUserProfile`, `unitSystem` |
| Daily Health (7) | `getUserSummary`, `getStats` *(alias)*, `getStepsData`, `getHeartRates`, `getSleepData`, `getHrvData`, `getBodyBattery` |
| Activities (2) | `getActivities` *(paginated)*, `getActivity` |
| Body Composition (3) | `getWeighIns`, `addWeighIn`, `deleteWeighIn` |

Confirmed in this session: login, on-disk token persistence, and automatic OAuth2 refresh all
work end to end against a real account, and each method above returned real data.

### Implemented, not yet exercised live (2 methods)

| Category | Methods | Status |
|---|---|---|
| File Transfer | `downloadActivity`, `client.upload()` | Built and covered by the local test harness (mocked HTTP). Not yet run against Garmin's live upload/download endpoints. |

### Not yet implemented — roadmap (~145 methods)

Mirroring python-garminconnect's remaining category breadth, none of these exist here yet:
Devices & Gear, Workouts & Training Plans, Challenges & Badges, Goals, Personal Records,
Segments, Blood Pressure, Hydration, Menstrual Cycle Tracking, Social/Connections, Women's
Health, Gear Maintenance, Virtual Challenges, and the Garmin Connect notification/messaging
surface. Contributions that add any of these are welcome — see [Contributing](#-contributing).

## ℹ️ About

`garminconnect-js` fetches your health, fitness, and activity data from
[connect.garmin.com](https://connect.garmin.com) so you can use it in your own Node or Next.js
server code, without scraping HTML or reverse-engineering the mobile app yourself.

Data categories covered today:

- User profile and unit-system preferences
- Daily wellness: step counts, heart rate, sleep, HRV, Body Battery
- Activities: list, pagination, single-activity detail
- Body composition: weigh-in history, adding and deleting a weigh-in

**Compatibility:** requires **Node.js 18+**. This library is server-only — see
[Node runtime only](#-node-runtime-only) below for why. It has no runtime dependencies and does
not run in a browser or on an Edge runtime.

Garmin Connect has no public, documented API. Everything here talks to the same endpoints
[connect.garmin.com](https://connect.garmin.com) and the Garmin Connect mobile app use, so
Garmin can change or break any of it without notice.

## 📦 Installation & setup

```bash
npm install garminconnect-js
```

```ts
import { GarminClient, Garmin, FileTokenStore } from "garminconnect-js";

const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
await client.login(process.env.GARMIN_EMAIL!, process.env.GARMIN_PASSWORD!);

const garmin = new Garmin(client);
console.log(await garmin.getUserProfile());
```

See [Authentication](#-authentication) below for the MFA case and for how tokens are stored
and refreshed.

## 🛠️ Development setup

```bash
git clone https://github.com/ificko/garminconnect-js.git
cd garminconnect-js
npm install
```

| Command | What it does |
|---|---|
| `npm run build` | Bundles `src` to `dist` with tsup (ESM + CJS + types). |
| `npm run typecheck` | `tsc --noEmit` over `src`, `tests`, `scripts`, `examples`. |
| `npm run lint` | ESLint over `src` and `tests`. |
| `npm run format` | Prettier, writing in place. |
| `npm test` | Runs the unit/integration suite against mocked HTTP (see [Testing](#-testing)). |
| `npm run test:watch` | Same, in watch mode. |
| `npm run test:live` | Runs the live suite against the real Garmin API — requires `./tokens` from `npm run login`. |
| `npm run login` | One-time interactive login; writes tokens to `./tokens`. |
| `npm run demo` | Runs [`examples/demo.ts`](examples/demo.ts) against the tokens in `./tokens`. |
| `npm run record` | Refreshes the scrubbed fixtures under `tests/fixtures/` from a live account (requires tokens). |

## 🔐 Authentication

Login follows Garmin's SSO flow, the same one `garth` and python-garminconnect use:
`GarminClient.login(email, password)` exchanges credentials for an OAuth1 token, then exchanges
that for a short-lived OAuth2 access token. Both are handed to your `TokenStore`.

**Using a `.env` file:** The dev scripts (`npm run login`, `npm run demo`, `npm run record`) 
automatically load `GARMIN_EMAIL` and `GARMIN_PASSWORD` from a `.env` file in the repo root, 
if one exists. This avoids storing credentials in shell history. Real environment variables take 
precedence, so CI and production workflows remain unaffected. The `.env` file is already listed 
in `.gitignore`.

- **Where tokens are stored:** wherever your `TokenStore` puts them. `FileTokenStore` writes
  `oauth1_token.json` and `oauth2_token.json` to a directory you choose (`./tokens` in the
  examples above), using garth's on-disk format — tokens produced by Python `garth` load here
  unchanged. For serverless, implement the same three-method interface against your own
  database or cache; see [`TokenStore` example](#bring-your-own-token-storage) below.
- **Auto-refresh:** the OAuth2 access token refreshes automatically, using the OAuth1 token (not
  an OAuth2 refresh token — Garmin's flow doesn't have one), before it expires. You never call
  refresh yourself; `connectapi()` calls do it transparently and persist the refreshed token back
  to your store.
- **Observed lifetimes:** in this session, OAuth2 access tokens lasted roughly 27 hours, and the
  OAuth1 token stayed valid for about 30 days. In practice, a session keeps rolling forward as
  long as you use it — call any method — at least once every 30 days. Beyond that window,
  `GarminAuthError` is thrown and you need to log in again.
- **Cached tokens:** once tokens exist in your store, `client.loadTokens()` reads them back and
  no further password prompt is needed until the refresh window above lapses.

### MFA across two HTTP requests

`login()` returns `{ state: "mfa_required", mfaState }` instead of throwing. `mfaState` is plain
JSON with **no password in it**, so it survives a round trip through a session store — which is
what makes MFA work on serverless, where the code arrives in a different request than the one
that started the login:

```ts
// app/api/garmin/login/route.ts
export const runtime = "nodejs";

export async function POST(req: Request) {
  const { email, password } = await req.json();
  const client = new GarminClient({ tokenStore: myStore });
  const result = await client.login(email, password);

  if (result.state === "mfa_required") {
    await session.set("garminMfa", result.mfaState); // encrypted session
    return Response.json({ mfaRequired: true, method: result.mfaState.mfaMethod });
  }
  return Response.json({ mfaRequired: false });
}

// app/api/garmin/mfa/route.ts
export async function POST(req: Request) {
  const { code } = await req.json();
  const mfaState = await session.get("garminMfa");
  const client = new GarminClient({ tokenStore: myStore });
  await client.resumeLogin(mfaState, code);
  await session.delete("garminMfa");
  return Response.json({ ok: true });
}
```

Treat `mfaState` as a short-lived secret: encrypt it at rest and delete it once used. The MFA
path is implemented and unit-tested but, unlike the 14 methods above, has not been exercised
against a real MFA-enabled account in this session.

### What running it locally does

`npm run login` and `npm run demo` talk to the real `connectapi.garmin.com` /
`sso.garmin.com` endpoints using **your real Garmin credentials and your real account data**.
Concretely:

- `npm run login` sends your email and password to Garmin's SSO service over HTTPS, the same
  request the mobile app makes, and writes real OAuth tokens to `./tokens` (gitignored).
- `npm run demo` and `npm run record` then use those tokens to fetch **your own** steps, heart
  rate, sleep, HRV, activities, and body-composition history.
- `npm run demo`'s "Export all to JSON" option writes a file under `./export/` (gitignored) that
  has been passed through the same `scrub()` helper the test fixtures use — but scrubbing
  redacts by field name, not by content, so free-text fields (activity titles, notes) are not
  scanned. Treat any export as containing real personal data.
- None of this data leaves your machine except in requests to Garmin's own servers. Nothing is
  sent to any third party by this library.

## ✅ Testing

```bash
npm test
```

189 tests across 15 files, all against mocked HTTP (via `msw`) — no network access and no
credentials required. Covers auth/SSO/MFA, token storage and refresh, the HTTP fetcher's retry
and error handling, every service method, and the public build output.

```bash
npm run test:live
```

Runs a separate suite against the real Garmin API. Requires tokens from `npm run login` and is
not part of CI; run it locally when you want to confirm live behavior.

## 🤝 Contributing

Before opening a PR:

- [ ] `npm run typecheck` passes with no `any` and `strict` mode intact.
- [ ] `npm run lint` passes.
- [ ] `npm test` passes (and stays at 189+ green tests — add tests for anything you add).
- [ ] New endpoints follow the existing `services/*` + `Garmin` method pattern, with a typed
      response interface in `types/`.
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
- [ ] No real credentials, tokens, personal names, emails, or GPS coordinates in anything
      committed — recorded fixtures must go through `scrub()` and be manually inspected before
      staging, per the reminder `npm run record` prints.
- [ ] If you're closing a roadmap gap from [API coverage](#-api-coverage), update the table
      above rather than leaving it stale.

## 💻 Code examples

### Node runtime only

This library uses `node:crypto` and `Buffer`. It does not run on the Edge runtime. In a Next.js
route handler:

```ts
export const runtime = "nodejs";
```

Never import it into a Client Component — credentials and tokens must stay on the server.

### Reading data

```ts
// lib/garmin.ts
import { GarminClient, Garmin } from "garminconnect-js";

export async function getGarmin() {
  const client = new GarminClient({ tokenStore: myStore });
  if (!(await client.loadTokens())) throw new Error("Not connected to Garmin");
  return new Garmin(client);
}

// app/api/sleep/route.ts
export const runtime = "nodejs";

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date")!;
  const garmin = await getGarmin();
  return Response.json(await garmin.getSleepData(date));
}
```

`Garmin` caches the resolved user profile (and user settings) for the lifetime of the instance —
`getGarmin()` above builds a fresh `Garmin` per request, which is fine for a single call, but any
date-scoped method (`getSleepData`, `getStepsData`, ...) resolves `displayName` first, so a new
`Garmin` per request costs an extra `socialProfile` fetch on every call. If a request handler
makes several Garmin calls, or you're calling from a long-lived process (a cron job, a worker),
hoist and reuse one `Garmin` instance instead of building a new one per call.

Dates are interpreted as **UTC calendar dates**, not local ones. Passing a `Date` object (instead
of a `"YYYY-MM-DD"` string) is formatted with `toISOString().slice(0, 10)`, so a caller in a
negative UTC-offset timezone (e.g. US Pacific) who calls `new Date()` late in their local day can
get tomorrow's date, because it's already tomorrow in UTC. Pass an explicit `"YYYY-MM-DD"` string
when you need the calendar date in the user's own timezone.

`getSleepData` returns `SleepData | null` — and so does `getHrvData` — rather than throwing, when
Garmin has no data for the requested date. Check for `null` before using the result.

### Bring your own token storage

`FileTokenStore` suits scripts and a single long-lived server. On serverless, implement the
three-method interface against whatever you already run:

```ts
import type { TokenStore, Tokens } from "garminconnect-js";
// `Redis` here is illustrative — bring your own client's type
// (e.g. `import type { Redis } from "ioredis";`).
type Redis = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<unknown>; del(key: string): Promise<unknown> };

export class RedisTokenStore implements TokenStore {
  constructor(private redis: Redis, private userId: string) {}

  async load(): Promise<Tokens | null> {
    const raw = await this.redis.get(`garmin:${this.userId}`);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  }
  async save(tokens: Tokens): Promise<void> {
    await this.redis.set(`garmin:${this.userId}`, JSON.stringify(tokens));
  }
  async clear(): Promise<void> {
    await this.redis.del(`garmin:${this.userId}`);
  }
}
```

### Uploading a file

```ts
const client = new GarminClient({ tokenStore: myStore });
await client.loadTokens();

const file = new Blob([fitBytes]);
await client.upload(file, "ride.fit");
// Custom path and a longer per-request timeout for a slow link:
await client.upload(file, "ride.fit", "/upload-service/upload", { timeoutMs: 120_000 });
```

`upload(file, filename, path?, options?)` posts multipart form data (field name `file`) to `path`
(default `/upload-service/upload`) and defaults to a 60s timeout, longer than the 10s default for
ordinary JSON calls, since it's moving a binary payload. **Not yet exercised against the live
Garmin service** — verified only against the local test harness.

### Errors

| Error | Meaning |
|---|---|
| `GarminError` | Base class for everything below; also thrown directly for malformed responses. |
| `GarminAuthError` | 401/403, failed SSO, or expired tokens. Log in again. |
| `GarminRateLimitError` | 429. Carries `retryAfter` seconds when Garmin sends it. |
| `GarminConnectionError` | Network failure or timeout, after retries. |
| `GarminHttpError` | Any other non-2xx. Carries `status`, `url`, `body`. |

## 📚 Additional resources & acknowledgements

- [connect.garmin.com](https://connect.garmin.com) — the service this library talks to.
- [python-garminconnect][python-garminconnect-url] — the upstream project this is a port of;
  the endpoint surface follows it.
- [garth][garth-url] — the Python auth library whose SSO/OAuth flow this port follows.
- `NOTICE` in this repo — attribution details for both upstream projects.

Garmin Connect has no public API. This library talks to the endpoints the mobile app uses, with
credentials fetched from the same third-party source `garth` uses. Garmin can change or break
any of it without notice. Don't build anything safety-critical on it, and expect to update when
login stops working.

## License

MIT. See `NOTICE` for attribution to python-garminconnect and garth.

[python-garminconnect-url]: https://github.com/cyberjunky/python-garminconnect
[garth-url]: https://github.com/matin/garth
[release-shield]: https://img.shields.io/github/v/release/ificko/garminconnect-js?style=flat
[release-url]: https://github.com/ificko/garminconnect-js/releases
[activity-shield]: https://img.shields.io/github/last-commit/ificko/garminconnect-js?style=flat
[activity-url]: https://github.com/ificko/garminconnect-js/commits/main
[license-shield]: https://img.shields.io/github/license/ificko/garminconnect-js?style=flat
[license-url]: https://github.com/ificko/garminconnect-js/blob/main/LICENSE
[maintenance-shield]: https://img.shields.io/badge/Maintained%3F-yes-green.svg?style=flat
[maintenance-url]: https://github.com/ificko/garminconnect-js/graphs/commit-activity
