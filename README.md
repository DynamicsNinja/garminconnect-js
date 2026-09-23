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

python-garminconnect exposes 154 public methods across ~14 categories. As of this version,
`garminconnect-js` ports **all 154 of them** — every `python_name` in
[`docs/upstream-method-inventory.md`](docs/upstream-method-inventory.md) has a real `Garmin`
counterpart, mechanically checked by `tests/parity.test.ts` on every test run (it reflects on
`Garmin.prototype` and re-parses the inventory each time, so this claim cannot silently drift out
of date). `Garmin.prototype` has 157 methods — 3 more than 154. The extras are `getUserProfile`,
`displayName` and `userName`: port-local helpers with no upstream row of their own.
`getUserProfile` reads `/userprofile-service/socialProfile` (upstream's similarly-named
`get_user_profile` is a different endpoint, satisfied here by `getUserSettings`), and the other
two are cached accessors over it.

**Full method-by-method detail — signatures, live-verification status per method, and every known
gotcha — lives in [`AGENTS.md`](AGENTS.md) section 3**, not here; this table is a summary. It's
also the file an AI coding agent working against this library should read first.

| Category | Methods | Live-verified reads | Notes |
|---|---|---|---|
| Wellness (steps, heart rate, sleep, HRV, stress, SpO2, respiration, hydration, blood pressure, …) | 30 | almost all | `setBloodPressure`, `deleteBloodPressure`, `addHydrationData` implemented but not live-verified (writes without a safe round-trip on this account) |
| Activities (list/search/detail, splits, weather, manual creation, import/upload, exercise sets, personal records) | 28 | most | destructive/one-shot writes (`deleteActivity`, `setActivityName`/`Type`/`Description`, `createManualActivity`, `importActivity`) verified via create→verify→delete round-trips against a disposable test account; `uploadActivity` and `downloadHealthSnapshot` are exceptions — see AGENTS.md |
| Metrics (training status, race predictions, FTP, lactate threshold, heart-rate/power zones, endurance/hill score, …) | 16 | yes | all branches (including the two-branch methods like `getLactateThreshold`) live-verified |
| Workouts (CRUD, per-sport upload, scheduling, device push) | 18 | most | `pushWorkoutToDevice` attempted but unverifiable — the test account has no paired device |
| Gear (CRUD, activity association, defaults, stats) | 9 | most | `setGearDefault`'s success path could not be made to work live against any tried input — see AGENTS.md |
| Devices | 6 | partial | the test account has no paired device, so `getDeviceSettings`/`getDeviceSolarData` are unit-tested only |
| Badges & Challenges | 8 | yes | |
| Body composition & weight | 8 | yes | `addBodyComposition` (FIT-file upload) is implemented but not live-verified |
| Women's health (menstrual cycle, pregnancy) | 11 | reads only | the 5 write methods are deliberately never live-tested against any account — irreversible health-data writes; unit-tested only |
| Golf | 5 | yes (golf-less account) | scorecard/shot-detail response shapes are unverified — the test account has no recorded rounds |
| User profile, goals, nutrition, training plans, misc (lifestyle log, reload request, GraphQL passthrough, logout) | 4+1+3+3+4 | mostly | `requestReload` (a write) and `logout` are deliberately never run against the live token store — see below |

**Deliberately unverified, by policy, not oversight:** any write with no safe way to undo it on a
real account (`addHydrationData`, `updateMenstrualDailyLog` and its four siblings, `requestReload`,
`pushWorkoutToDevice`'s final POST), plus `logout()` — calling it against the token store backing
this repo's own live tests would force an interactive MFA re-login, so it is unit-tested against
`MemoryTokenStore`/a temp-dir `FileTokenStore` only. None of this is a gap in effort; it's the
project's standing rule that a live *write* probe only runs when it can be verified (read the
value back) and undone.

**EU accounts:** every write endpoint can return `412 PreconditionFailedException` ("The user is
from EU location, but upload consent is not yet granted or revoked") until upload consent is
granted in Garmin Connect's own settings UI. This is an account-state precondition, not a bug in
this library — see [Known limitations](#eu-upload-consent-412) below.

## ℹ️ About

`garminconnect-js` fetches your health, fitness, and activity data from
[connect.garmin.com](https://connect.garmin.com) so you can use it in your own Node or Next.js
server code, without scraping HTML or reverse-engineering the mobile app yourself.

Data categories covered today (see [API coverage](#-api-coverage) for the full, honest breakdown):

- User profile, unit-system preferences, goals
- Daily wellness: step counts, heart rate, sleep, HRV, stress, SpO2, respiration, hydration,
  blood pressure, body battery
- Activities: list, search, detail, splits, weather, manual creation, GPX/TCX/FIT import, gear
  association, personal records
- Body composition and weigh-ins
- Training metrics: training status, race predictions, FTP, lactate threshold, HR/power zones
- Workouts: CRUD, per-sport builders, scheduling, device push
- Gear: CRUD, activity association, defaults, maintenance stats
- Devices, badges & challenges, women's health, golf, nutrition, training plans
- The raw GraphQL gateway passthrough and other `connectapi` escape-hatch use cases

**Compatibility:** requires **Node.js 18+**. This library is server-only — see
[Node runtime only](#-node-runtime-only) below for why. It has no runtime dependencies and does
not run in a browser or on an Edge runtime.

### <a id="eu-upload-consent-412"></a>Known limitation: EU upload consent (412)

Garmin returns `412 PreconditionFailedException: "The user is from EU location, but upload
consent is not yet granted or revoked"` for **every write** (`addWeighIn`, `importActivity`,
`createManualActivity`, workout uploads, gear writes — all of them) on an EU-region account that
has not clicked through Garmin Connect's upload-consent flow. This was hit live during this
project's own development. It is an account-state precondition, not a library bug: the request
shape and URL are correct, and Garmin's server is refusing the write until the account owner
grants consent in Garmin Connect's own settings UI. There is no method in this library that wraps
Garmin's own consent-status check — it isn't a `python-garminconnect` method either — but you can
read it directly:

```ts
// Response shape below is LIVE-OBSERVED, not assumed. There is no `enabled` field:
// the signal is `userOption`, which reads "opt-in" once consent has been granted.
const consent = await client.connectapi<{ userOption?: string }>(
  "/gdprconsent-service/feature/UPLOAD",
);
const uploadConsentGranted = consent?.userOption === "opt-in";
```

If your first write against an EU account 412s, check this before assuming your request is wrong.

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
export const runtime = "nodejs";

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
path is implemented and unit-tested; see [`AGENTS.md`](AGENTS.md) section 5 for its live-testing
status.

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

521 tests across 35 files, all against mocked HTTP (via `msw`) — no network access and no
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
- [ ] `npm test` passes (and stays green — add tests for anything you add).
- [ ] `tests/parity.test.ts` still passes — if you're adding a `connectapi`-only endpoint upstream
      also has as a public method, port it as a real `Garmin` method instead, or that test will
      fail (by design).
- [ ] New endpoints follow the existing `services/*` + `Garmin` method pattern, with a typed
      response interface in `types/`.
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
- [ ] No real credentials, tokens, personal names, emails, or GPS coordinates in anything
      committed — recorded fixtures must go through `scrub()` and be manually inspected before
      staging, per the reminder `npm run record` prints.
- [ ] If you're changing what's implemented, update the [API coverage](#-api-coverage) table
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
| `GarminConnectionError` | Network failure or timeout, after retries — **and** a few semantic HTTP statuses that some services deliberately re-raise as this class, mirroring upstream: **every** HTTP error from `importActivity` (not just its 409 "Activity already exists" — a 400 or 413 is wrapped the same way), the 404 ("gear not found (likely retired/removed)") from `addGearToActivity`, `removeGearFromActivity` and `setGearDefault`, and a missing `deviceSolarInput` from `getDeviceSolarData`. Those are permanent, not transient — do not blanket-retry on this class; check the message or the `cause`. |
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
