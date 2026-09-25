<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/title-dark.svg">
  <img src="docs/assets/title-light.svg" alt="garminconnect-js — TypeScript client for Garmin Connect" width="705">
</picture>

[![npm][npm-shield]][npm-url]
[![Node][node-shield]][node-url]
[![License][license-shield]][license-url]
[![Last Commit][activity-shield]][activity-url]
[![Maintenance][maintenance-shield]][maintenance-url]
[![Buy Me a Coffee][bmc-shield]][bmc-url]

<sub>**Unofficial.** Not affiliated with, endorsed by, or supported by Garmin. Garmin and Garmin
Connect are trademarks of Garmin Ltd. or its subsidiaries.</sub>

</div>

A zero-dependency TypeScript client for Garmin Connect, for **Node and Next.js server runtimes**.
It talks to the same undocumented endpoints the mobile app uses, with a fully typed,
promise-based API.

It handles Garmin's undocumented SSO/OAuth flow, refreshes tokens for you, and gives you 165
typed methods over the endpoints the mobile app uses — plus two things that exist because Garmin's
API is quietly hostile in specific places:

- **A fluent workout builder.** Garmin's workout JSON has four traps that produce a silently wrong
  workout rather than an error: global `stepOrder` numbering that runs through repeat children,
  id/key triples that must agree, rests measured in a different field from times, and pace targets
  expressed as descending metres per second. `buildWorkout` makes all four unreachable — see
  [`WORKOUTS.md`](WORKOUTS.md).
- **The exercise catalogue, type-checked.** Garmin stores an unrecognised exercise name as an empty
  string and returns success, so a typo costs you the exercise and tells you nothing.
  `garminconnect-js/exercises` turns that into a compile error, with 1830 names verified one by one
  against a live account.

Behind both: a verification habit. Every method carries a live-verification status in
[`AGENTS.md`](AGENTS.md), and a write is only "verified" once the stored value has been read back —
a 2xx on its own has twice hidden a real defect here.

**Want a running app first?** [**garminconnect-nextjs-starter**](https://github.com/DynamicsNinja/garminconnect-nextjs-starter)
is a Next.js template that signs in (MFA included) and charts your sleep and HRV. Click
**Use this template**, and you're a `npm run dev` away from your own data. Or try the
[live demo](https://garmin.ficdev.xyz) first.

If you're an AI coding agent (or configuring one), read [`AGENTS.md`](AGENTS.md) first — it's a
terser, higher-signal briefing than this README and calls out what does *not* exist here.

## ℹ️ About

`garminconnect-js` fetches your health, fitness, and activity data from
[connect.garmin.com](https://connect.garmin.com) so you can use it in your own Node or Next.js
server code, without scraping HTML or reverse-engineering the mobile app yourself.

It covers wellness, activities, training metrics, workouts, gear, courses, devices, badges, body
composition, women's health, golf, nutrition and training plans — see [API coverage](#-api-coverage)
for the breakdown. For anything it doesn't wrap, `client.connectapi()` calls any Garmin Connect
endpoint with the same auth.

**Compatibility:** requires **Node.js 18+**. This library is server-only — see
[Node runtime only](#node-runtime-only) below for why. It has no runtime dependencies and does
not run in a browser or on an Edge runtime.

**Status:** `0.x`, so the public API may still change between minor versions; breaking changes are
listed in [`CHANGELOG.md`](CHANGELOG.md). The endpoints underneath are undocumented and belong to
Garmin, who can change them at any time — which is why every method carries a verification date
rather than an assurance.

Garmin Connect has no public, documented API. Everything here talks to the same endpoints
[connect.garmin.com](https://connect.garmin.com) and the Garmin Connect mobile app use, so Garmin
can change or break any of it without notice. Don't build anything safety-critical on it, and
expect to update when login stops working.

### <a id="eu-upload-consent-412"></a>Known limitation: EU upload consent (412)

Garmin returns `412 PreconditionFailedException: "The user is from EU location, but upload
consent is not yet granted or revoked"` for **every write** (`addWeighIn`, `importActivity`,
`createManualActivity`, workout uploads, gear writes — all of them) on an EU-region account that
has not clicked through Garmin Connect's upload-consent flow. This was hit live during this
project's own development. It is an account-state precondition, not a library bug: the request
shape and URL are correct, and Garmin's server is refusing the write until the account owner
grants consent in Garmin Connect's own settings UI. No method in this library wraps Garmin's
consent-status check, but you can read it directly:

```ts
// Response shape below is LIVE-OBSERVED, not assumed. There is no `enabled` field:
// the signal is `userOption`, which reads "opt-in" once consent has been granted.
const consent = await client.connectapi<{ userOption?: string }>(
  "/gdprconsent-service/feature/UPLOAD",
);
const uploadConsentGranted = consent?.userOption === "opt-in";
```

If your first write against an EU account 412s, check this before assuming your request is wrong.

## 📦 Installation & setup

```bash
npm install garminconnect-js
```

```ts
import { GarminClient, Garmin, FileTokenStore } from "garminconnect-js";

const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
const result = await client.login(process.env.GARMIN_EMAIL!, process.env.GARMIN_PASSWORD!);

if (result.state === "mfa_required") {
  // login() does not throw or block on MFA — finish it with the code Garmin sent.
  await client.resumeLogin(result.mfaState, await promptForCode());
}

const garmin = new Garmin(client);
console.log(await garmin.getUserProfile());
```

(`promptForCode` is yours to supply — stdin in a script, a second HTTP request in a web app; see
[MFA across two HTTP requests](#mfa-across-two-http-requests).) Tokens are now in `./tokens`, so a
later process skips the password entirely:

```ts
const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
if (!(await client.loadTokens())) throw new Error("Not connected to Garmin — log in first");
const garmin = new Garmin(client);
```

`loadTokens()` returns `false` rather than throwing when the store is empty.

### Client options

`new GarminClient(options?)` accepts:

| Option | Default | What it does |
|---|---|---|
| `tokenStore` | `new MemoryTokenStore()` | Where tokens are loaded from and saved to. See [Authentication](#-authentication). |
| `isCn` | `false` | `true` routes every request to `garmin.cn` for accounts registered in China. |
| `timeoutMs` | `10000` | Per-request timeout for ordinary JSON calls. `download()`/`upload()` default to 60s; every call can override it with `{ timeoutMs }`. |
| `retries` | `3` | Retries after the first attempt, on a network error or a 408/500/502/503/504. **POST is never retried**, so a write cannot be duplicated. |
| `backoffMs` | `500` | Base delay between retries, doubling each attempt (500, 1000, 2000 ms). |
| `fetchImpl` | `globalThis.fetch` | Swap in your own `fetch` — for tests (see [Testing](#-testing)), a proxy, or instrumentation. |
| `loginDelayMs` | random 3000–8000 | Pause before the SSO widget's credential POST, used only when the mobile login is rate limited (see [Authentication](#-authentication)). Set `0` in tests. |

## 🔐 Authentication

Login follows Garmin's SSO flow, the same one `garth` and python-garminconnect use:
`GarminClient.login(email, password)` exchanges credentials for an OAuth1 token, then exchanges
that for a short-lived OAuth2 access token. Both are handed to your `TokenStore`.

- **Rate-limited sign-in.** Garmin rate limits the mobile sign-in route, per client id and
  source IP, often after one or two sign-ins. When the mobile sign-in page or `/mobile/api/login`
  answers HTTP 429, or `/mobile/api/login` reports a 429 inside a 200 JSON reply, `login()` signs
  in once more through Garmin's SSO web widget (`/sso/embed` + `/sso/signin`), which sends no
  client id, and returns the same tokens. If the widget is rate limited too,
  `GarminRateLimitError` names the widget URL; other widget failures start with
  `Mobile login rate limited; `, and a rejected password keeps its `SSO error:` prefix. Tokens
  refresh for about 30 days without signing in, so keep them in a `TokenStore` rather than
  signing in again.
- **Where tokens are stored:** wherever your `TokenStore` puts them. `FileTokenStore` writes
  `oauth1_token.json` and `oauth2_token.json` to a directory you choose (`./tokens` in the
  examples above), using garth's on-disk format — tokens produced by Python `garth` load here
  unchanged. For serverless, implement the same three-method interface against your own
  database or cache; see [`TokenStore` example](#bring-your-own-token-storage) below.
- **Auto-refresh:** the OAuth2 access token refreshes automatically, using the OAuth1 token (not
  an OAuth2 refresh token — Garmin's flow doesn't have one), before it expires. You never call
  refresh yourself; `connectapi()` calls do it transparently and persist the refreshed token back
  to your store.
- **Observed lifetimes:** OAuth2 access tokens have lasted roughly 27 hours, and the OAuth1 token
  about 30 days. In practice a session keeps rolling forward as long as you use it — call any
  method — at least once every 30 days. Beyond that window, `GarminAuthError` is thrown and you
  need to log in again.
- **Cached tokens:** once tokens exist in your store, `client.loadTokens()` reads them back and
  no further password prompt is needed until the refresh window above lapses.
- **A third-party request at login.** The OAuth consumer key and secret are not bundled; like
  `garth`, the library fetches them from `https://thegarth.s3.amazonaws.com/oauth_consumer.json`,
  a bucket run by garth's author. That happens once per process, on the first login or token
  refresh, and the result is cached. If that URL is unreachable — an outage, or a server whose
  egress is firewalled — login and refresh fail with a `GarminConnectionError`. Allow-list it if
  you restrict outbound traffic.

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

Treat `mfaState` as a short-lived secret: `mfaState.cookies` is a live, partially authenticated
SSO session, so anyone holding it can finish the login with the code. Encrypt it at rest, scope it
to the session that started the login, and delete it once used. The MFA path is exercised live by
`npm run login` (see [See it run](#-see-it-run)) as well as unit-tested.

`mfaState.flow` says which sign-in route produced it: `"mobile"` (the default; states saved by
0.1.0 or 0.2.0 have no `flow` and count as mobile) or `"widget"`. A widget state also holds the
page's CSRF token and form parameters. Pass either kind straight back to `resumeLogin`; read
`loginParams` only after checking `flow !== "widget"`.

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

**Persist the whole `Tokens` object — in particular `expires_at` and `refresh_token_expires_at`,
as numbers.** Every refresh decision reads them. Storing the whole JSON blob, as above, keeps
them; a database schema or a field allowlist that drops them does not, and the client then treats
the token as expired (it fails closed) and refreshes on every call. Round-trip your store once in
a test and assert both numbers survive.

### Uploading an activity file

```ts
import { readFile } from "node:fs/promises";

const file = new Blob([await readFile("ride.fit")]);

// As an import — the extension picks the endpoint, and must be .fit, .gpx or .tcx:
const imported = await garmin.importActivity(file, "ride.fit");

// Or as an ordinary device-sync-shaped upload:
await garmin.uploadActivity(file, "ride.fit");
```

Both are live-verified: a synthetic GPX was uploaded, found by polling `getActivities` once Garmin
finished processing it asynchronously (a few seconds to ~20s), then deleted. A duplicate file
makes `importActivity` throw a `GarminConnectionError` ("Activity already exists"). The two hit
different endpoints with different headers — see [`AGENTS.md`](AGENTS.md) section 6 before
swapping one for the other.

Both are built on `client.upload(file, filename, path?, options?)`, which you can call directly
for an endpoint no method wraps. It posts multipart form data (field name `file`) to `path`
(default `/upload-service/upload`) with a 60s default timeout:

```ts
await client.upload(file, "ride.fit", "/upload-service/upload", { timeoutMs: 120_000 });
```

### Courses

A course is a saved route you can send to a device and follow. Creating one from a GPX file is two
steps inside Garmin — parse, then save — and `createCourseFromGpx` does both:

```ts
const course = await garmin.createCourseFromGpx(new Blob([gpxText]), "loop.gpx", {
  name: "Sunday loop",
  activityTypeId: 10, // a Garmin activity-type id; the default, 1, is running
  privacy: "private",
});

await garmin.updateCourse(course!.courseId!, { name: "Sunday long loop", privacy: "public" });
const gpx = await garmin.downloadCourseGpx(course!.courseId!);
```

Right after creation Garmin is still processing the course, and an update or delete can fail with
a 429 "not yet ready" — a `GarminRateLimitError`, though it is not rate limiting. Retry after a few
seconds.

### Errors

| Error | Meaning |
|---|---|
| `GarminError` | Base class for everything below; also thrown directly for malformed responses. |
| `GarminAuthError` | 401/403, failed SSO, or expired tokens. Log in again. |
| `GarminRateLimitError` | 429. Carries `retryAfter` seconds when Garmin sends it. |
| `GarminConnectionError` | Network failure or timeout, after retries — **and** a few semantic HTTP statuses that some services deliberately re-raise as this class, mirroring upstream: **every** HTTP error from `importActivity` (not just its 409 "Activity already exists" — a 400 or 413 is wrapped the same way), the 404 ("gear not found (likely retired/removed)") from `addGearToActivity` and `removeGearFromActivity`, and a missing `deviceSolarInput` from `getDeviceSolarData`. Those are permanent, not transient — do not blanket-retry on this class; check the message or the `cause`. |
| `GarminHttpError` | Any other non-2xx. Carries `status`, `url`, `body`. |

## 🏊 Building workouts

Creating a Garmin workout by hand means writing deeply nested JSON with several non-obvious rules —
step numbering that runs across repeat blocks, enum references that must agree in three places, and
pace targets expressed as descending metres-per-second. `buildWorkout` handles all of that:

```ts
import { buildWorkout } from "garminconnect-js";

const workout = buildWorkout("4 x 1 km", { sport: "running" })
  .warmup({ time: 600, target: { heartRateZone: 2 } })
  .repeat(4, (set) =>
    set
      .interval({
        distance: 1000,
        target: { pace: { minPerKm: [4.5, 5] } },
        secondaryTarget: { cadence: [176, 184] },
      })
      .recovery({ time: 120 }),
  )
  .cooldown({ lapButton: true })
  .build();

await garmin.uploadWorkout(workout);
```

It covers all twelve sports, every step and end-condition type, primary and secondary targets,
nested and time-boxed repeats, swim strokes/drills/equipment, strength exercises and weights, and
multi-sport bricks. `uploadWorkout` still accepts raw JSON, so the builder is optional.

For strength work, Garmin accepts an unknown exercise `name` and silently stores it as an empty
string — no error, just a step with no exercise. So the builder type-checks it: once you pick a
`category`, `name` autocompletes to that category's names, and anything else is a compile error.
All 1830 names were verified one by one against a live account:

```ts
.interval({ reps: 8, exercise: { category: "SQUAT", name: "BARBELL_BACK_SQUAT" }, weightKg: 60 })
```

The catalogue itself is a separate entry point, `garminconnect-js/exercises`, so its data never
reaches the root bundle. Import it when you need the list or a runtime check:

```ts
import { EXERCISES, exercise, isExerciseName } from "garminconnect-js/exercises";

EXERCISES.SQUAT;                                  // all 106 squat names, e.g. for a picker
exercise("SQUAT", "BARBELL_BACK_SQUAT");          // the same compile-time check, as a helper
isExerciseName("SQUAT", nameFromYourDatabase);    // for names that are only strings at runtime
```

**→ [`WORKOUTS.md`](WORKOUTS.md) is the full guide**, with a worked example for every sport and a
reference for every option. Runnable versions of those examples live in
[`examples/workout-gallery.ts`](examples/workout-gallery.ts).

## 📊 API coverage

**165 typed methods across 12 categories.** Each category links to a generated
[`docs/api/`](docs/api/README.md) page with every method's signature, a call you can paste, and
its live-verification status — confirmed against a real Garmin account, not merely unit-tested.

| Category | Methods | Verified live | Covers |
|---|---|---|---|
| [Wellness](docs/api/wellness.md) | 30 | all | steps, heart rate, sleep, HRV, stress, SpO2, respiration, hydration, blood pressure, body battery |
| [Activities](docs/api/activities.md) | 32 | all | list/search/detail, splits, weather, manual creation, import/upload, exercise sets, gear links, personal records |
| [Training metrics](docs/api/metrics.md) | 16 | all | training status, race predictions, FTP, lactate threshold, HR/power zones, endurance and hill score |
| [Workouts](docs/api/workouts.md) | 16 | all | CRUD, per-sport upload, scheduling, device push |
| [Gear](docs/api/gear.md) | 6 | all | CRUD, activity defaults, stats |
| [Courses](docs/api/courses.md) | 8 | all | import a GPX, create, rename, privacy, export as GPX, delete |
| [Devices](docs/api/devices.md) | 6 | all | devices, settings, alarms, solar, last used |
| [Badges & challenges](docs/api/badges-challenges.md) | 9 | all | earned/available badges, badge detail, challenges |
| [Body composition & weight](docs/api/body-composition-weight.md) | 8 | all | weigh-ins, body composition (FIT upload) |
| [Women's health](docs/api/womens-health.md) | 11 | all | menstrual cycle, pregnancy |
| [Golf](docs/api/golf.md) | 5 | 3 of 5 | summary, scorecards, shots, clubs, stats |
| [Profile, goals, nutrition, plans & misc](docs/api/profile-and-misc.md) | 18 | all¹ | profile, settings, goals, nutrition, training plans, GraphQL, logout |

¹ `logout()` makes no HTTP call, so there is nothing to verify against Garmin.

**Still unverified:** `getGolfScorecard` and `getGolfShotData`, because no available account has a
recorded round. `getGolfShotData` also returns an unexplained **410** against a made-up id, and one
real scorecard would show whether upstream's path is dead.

**Worth knowing before you call:**

- `addHydrationData` is permanent — Garmin has no delete for it.
- The badge-challenge endpoints reject `start=0` server-side; pass `start >= 1`.
- Women's-health writes need cycle-tracking settings that only Garmin's own first-run wizard
  creates. Run it once in the web UI first.

The per-method gotchas and the evidence behind every verification are in [`AGENTS.md`](AGENTS.md)
section 3.

### Relationship to python-garminconnect

This library began as a port of Python's [`garminconnect`][python-garminconnect-url] and its auth
dependency [`garth`][garth-url], and the endpoint surface and SSO flow still derive from them —
see [`NOTICE`](NOTICE) for attribution. It is no longer a port: 151 of upstream's 154 methods are
here, thirteen methods go beyond it (among them all eight course methods), and behaviour diverges where evidence warranted it.

Three upstream methods are deliberately absent, because live testing showed each can only produce
a broken result: `upload_walking_workout` and `upload_hiking_workout` (Garmin has no such workout
sport type — it stores a null one) and `set_gear_default` (the endpoint 404s against gear that
demonstrably exists). `getGoals` also defaults `start` to 1 rather than 0, because Garmin's
goal-service is 1-indexed and 0 silently returns "no goals" on an account that has them. Each
divergence is recorded with its reason in `tests/parity.test.ts`, which fails if one goes stale.

If you are migrating, [`AGENTS.md`](AGENTS.md) carries the full per-method mapping, including the
three upstream names that resolve to a differently-named method here.

The standing rule behind all of this: a live *write* probe only runs when the value can be read
back and the change undone, and a 2xx is never accepted as evidence on its own.

## 🛠️ Development setup

```bash
git clone https://github.com/DynamicsNinja/garminconnect-js.git
cd garminconnect-js
npm install
```

| Command | What it does |
|---|---|
| `npm run check` | Typecheck, lint, build and test, in that order — what CI and `prepublishOnly` run. Building first means the tests also cover the built package. |
| `npm run build` | Bundles `src` to `dist` with tsup (ESM + CJS + types). |
| `npm run typecheck` | `tsc --noEmit` over `src`, `tests`, `scripts`, `examples`. |
| `npm run lint` | ESLint over `src`, `tests`, `scripts` and `examples`. |
| `npm run format` | Prettier, writing in place. |
| `npm test` | Runs the unit/integration suite against mocked HTTP (see [Testing](#-testing)). |
| `npm run test:watch` | Same, in watch mode. |
| `npm run test:live` | Runs the live suite against the real Garmin API — requires `./tokens` from `npm run login`. |
| `npm run docs:api` | Regenerates [`docs/api/`](docs/api/README.md) from the code and `AGENTS.md`. A test fails if it is stale. |
| `npm run login` | One-time interactive login; writes tokens to `./tokens`. |
| `npm run demo` | Runs [`examples/demo.ts`](examples/demo.ts) against the tokens in `./tokens`. |
| `npm run record` | Refreshes the scrubbed fixtures under `tests/fixtures/` from a live account (requires tokens). |
| `npm run smoke` | Live read probes against the test account, by category (`npm run smoke -- misc`). |
| `npm run smoke:write` / `smoke:gaps` | Live write probes — create, read back, delete. |
| `npm run smoke:builder` | Builds, uploads, reads back and deletes a workout for each of the twelve sports. |
| `npm run smoke:matrix` | The builder's full option cross-product for swim, bike and run, compared field by field on read-back. |
| `npm run verify:exercises -- <in.json> <out.json>` | Verifies candidate exercise names by upload and read-back, keeping only those Garmin echoes back. |
| `npm run login:real` / `smoke:real` | Login to, and **read-only** probe of, a real personal account, on a transport that refuses any non-GET. Uses its own `./tokens-real`. See `AGENTS.md` section 8. |

The four write commands (`smoke:write`, `smoke:gaps`, `smoke:builder`, `smoke:matrix`) and
`verify:exercises` refuse to run unless the logged-in profile matches `GARMIN_TEST_PROFILE_ID` —
they are for a disposable test account, never a real one. `smoke:real` has the inverse gate: it
refuses if the profile DOES match.

**Credentials from a `.env` file:** the dev scripts (`npm run login`, `npm run demo`,
`npm run record`) load `GARMIN_EMAIL` and `GARMIN_PASSWORD` from a `.env` file in the repo root,
if one exists, so credentials stay out of shell history. `npm run login:real` reads
`GARMIN_REAL_EMAIL`/`GARMIN_REAL_PASSWORD` instead, so both accounts can share one `.env`. Real
environment variables take precedence, and `.env` is gitignored.

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
- None of your data leaves your machine except in requests to Garmin's own servers. The only
  other request is the OAuth consumer-key fetch described under
  [Authentication](#-authentication), which carries no account data.

## 📟 See it run

Two files show it working end to end:

- [`scripts/login.ts`](scripts/login.ts) — one-time interactive login. Prompts for an MFA code on
  stdin if Garmin asks for one, then writes tokens to `./tokens`.
- [`examples/demo.ts`](examples/demo.ts) — an interactive, numbered-menu demo (`npm run demo`)
  that loads those tokens and walks through the categories this library implements: profile,
  daily health, activities, body composition, and a JSON export.

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

## ✅ Testing

```bash
npm test
```

693 tests across 48 files, all against mocked HTTP (via `msw`) — no network access and no
credentials required. Covers auth/SSO/MFA, token storage and refresh, the HTTP fetcher's retry
and error handling, every service method, and the public build output.

```bash
npm run test:live
```

Runs a separate suite against the real Garmin API. Requires tokens from `npm run login` and is
not part of CI; run it locally when you want to confirm live behavior.

**Testing your own code against this library:** mock at the `fetch` layer rather than stubbing
`Garmin` methods. Pass a mock (or an `msw` handler) as `GarminClientOptions.fetchImpl`, and the
real request construction, auth headers, retries and response parsing all still run.

## 🤝 Contributing

Before opening a PR:

- [ ] `npm run check` passes — typecheck, lint, build and tests, in CI's exact order. CI runs this
      same script, so a green local run cannot diverge from a green pipeline by omission.
- [ ] `npm run docs:api` has been re-run if you changed a method or its `AGENTS.md` row, and the
      regenerated `docs/api/` files are committed. A test fails if they are stale.
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
- [ ] Note anything user-visible in [`CHANGELOG.md`](CHANGELOG.md).

Security issues go through [`SECURITY.md`](SECURITY.md), privately, not a public issue — this
library holds live Garmin credentials on people's behalf.

## ☕ Support

If this library saves you time, you can support its development:

[![Buy Me a Coffee][bmc-shield]][bmc-url]
[![PayPal][paypal-shield]][paypal-url]

## 📚 Additional resources & acknowledgements

- [connect.garmin.com](https://connect.garmin.com) — the service this library talks to.
- [python-garminconnect][python-garminconnect-url] — the upstream project this one grew out of;
  the endpoint surface follows it.
- [garth][garth-url] — the Python auth library whose SSO/OAuth flow this library follows.
- [`CHANGELOG.md`](CHANGELOG.md) — what changed in each release.
- [`NOTICE`](NOTICE) — attribution details for both upstream projects.

## License

MIT. See [`NOTICE`](NOTICE) for attribution to python-garminconnect and garth.

[python-garminconnect-url]: https://github.com/cyberjunky/python-garminconnect
[garth-url]: https://github.com/matin/garth
[npm-shield]: https://img.shields.io/npm/v/garminconnect-js?style=flat
[npm-url]: https://www.npmjs.com/package/garminconnect-js
[node-shield]: https://img.shields.io/node/v/garminconnect-js?style=flat
[node-url]: https://nodejs.org/
[activity-shield]: https://img.shields.io/github/last-commit/DynamicsNinja/garminconnect-js?style=flat
[activity-url]: https://github.com/DynamicsNinja/garminconnect-js/commits/main
[license-shield]: https://img.shields.io/github/license/DynamicsNinja/garminconnect-js?style=flat
[license-url]: https://github.com/DynamicsNinja/garminconnect-js/blob/main/LICENSE
[maintenance-shield]: https://img.shields.io/badge/Maintained%3F-yes-green.svg?style=flat
[maintenance-url]: https://github.com/DynamicsNinja/garminconnect-js/graphs/commit-activity
[bmc-shield]: https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-FFDD00?style=flat&logo=buymeacoffee&logoColor=black
[bmc-url]: https://buymeacoffee.com/dynamicsninja
[paypal-shield]: https://img.shields.io/badge/PayPal-donate-00457C?style=flat&logo=paypal&logoColor=white
[paypal-url]: https://paypal.me/ivanficko
