# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0] - 2026-10-06

### Added

Twenty-seven new methods, each verified live on 2026-10-06 by writing, reading the stored value
back, and restoring.

- **Calendar events** (new category): `listCalendarEvents`, `getCalendarEvent`,
  `createCalendarEvent`, `updateCalendarEvent`, `deleteCalendarEvent` for races and other events, and `getSharedCalendarEvent` for a race in Garmin's events catalogue (no subscription needed).
  Garmin keeps every event you create private.
- **Activity fields**: `getActivityEventTypes`, `setActivityEventType`,
  `setActivityPerceivedEffort` (RPE 1-10; Garmin stores it times ten), `setActivityFeel`.
- **Heart-rate zones**: `setHeartRateZones` (read-modify-write of one profile, returned as
  stored) and `deleteHeartRateZones` (removes a sport's own profile). Garmin does not recompute
  the floors when the method changes.
- **`getDailyStats`**: per-day calories or steps for any range, fetched in 28-day windows.
- **`getAdaptiveWorkout`**: a Garmin Coach workout by its uuid, which `getWorkoutById` cannot fetch.
- **`deleteTrainingPlan`**: quits an enrolled training plan, as Garmin Connect's "Quit Plan" does.
- **`getScheduledWorkoutSummaries`** and **`getTrainingPlanWorkouts`**: compact schedule reads
  over Garmin's GraphQL gateway. The summaries lag a fresh schedule by a few seconds.

- **Food logging** (needs Garmin Connect+, which needs a paired Garmin device): `searchFoods`,
  `getCustomFoods`, `getCustomFoodServingUnits`, `createCustomFood`, `updateCustomFood`,
  `deleteCustomFood`, `logFood`, `quickAddFood`, `deleteFoodLogs`, and
  `getNutritionFoodLogRange` (which works without Connect+). Logging picks the meal from the time
  of day, or picks a valid time for a named meal; Garmin rejects a snack logged inside another
  meal's window. Verified on a Connect+ account by `scripts/smoke-nutrition-real.ts`, which
  deletes everything it creates.

- **Garmin Connect+ awareness**: `hasConnectPlus()` reads the subscription from the cached user
  profile; `CONNECT_PLUS_METHODS` lists the methods that need it; and those methods throw the new
  `GarminConnectPlusRequiredError` (carrying `method`) instead of Garmin's bare 403, which used to
  surface as a `GarminAuthError` and read like an expired session. The manifest marks them
  `requiresConnectPlus`, and the API docs and MCP tool descriptions say so.

The MCP server gets the matching tools automatically, and a `calendar-events` tool group. A
missing Connect+ no longer makes it reset the session and try to sign in again.

## [0.8.2] - 2026-10-02

No changes to `garminconnect-js`; it is released in lockstep with the MCP server.

### Fixed (`@dynamicsninja/garminconnect-mcp`)

- **Sign in with a Garmin username**: older Garmin accounts sign in with a username rather than an
  email, but the sign-in page's email-only field would not let the browser submit one. The field
  now accepts either, and the extension setting, the `login` prompt and the error messages say
  "email or username". The `garmin_email` setting and `GARMIN_EMAIL` keep their names, so saved
  settings keep working.

## [0.8.1] - 2026-10-01

No changes to `garminconnect-js`; it is released in lockstep with the MCP server.

### Added (`@dynamicsninja/garminconnect-mcp`)

- **Sign in from the extension settings**: optional *Garmin email* and *Garmin password* settings
  (the password marked sensitive, so Claude Desktop keeps it in the system's secure storage). With
  both set, the server signs in by itself when there is no saved session, or after Garmin rejects
  it. Saved sessions always take priority, and the automatic sign-in is tried at most once per
  start, so a wrong password cannot get the account locked. Accounts with two-step verification
  still use `sign_in_to_garmin`. `GARMIN_EMAIL` / `GARMIN_PASSWORD` do the same for npm installs.

## [0.8.0] - 2026-09-29

No changes to `garminconnect-js`; it is released in lockstep with the MCP server.

### Added (`@dynamicsninja/garminconnect-mcp`)

- **A Claude Desktop Extension** (`garminconnect-mcp-<version>.mcpb`, attached to each GitHub
  Release): double-click to install, with an icon and settings for tool groups, download folder and
  GraphQL. No npm install and no config file to edit.
- **`sign_in_to_garmin`**: signs in without a terminal through a page served only on this computer
  (supports MFA; the password goes only to Garmin and is never stored). The "not logged in" message
  now points to it.

### Fixed (`@dynamicsninja/garminconnect-mcp`)

- Empty or unsubstituted settings (as a Desktop Extension may pass them) are treated as unset, and
  `GARMIN_MCP_ENABLE_GRAPHQL` accepts `true` as well as `1`. A `download_dir` still carrying a
  literal, unexpanded `${HOME}` (mcpb never expands that in a manifest default) or a relative path
  is also treated as unset and falls back to `~/Downloads/garmin`.
- `GARMIN_MCP_GROUPS` values are now matched case-insensitively and trimmed, and an unknown group
  name is ignored (logged to stderr) instead of stopping the whole server; if none of the requested
  names are valid, every tool group loads instead of none.

## [0.7.1] - 2026-09-29

No changes to `garminconnect-js`; it is released in lockstep with the MCP server.

### Changed (`@dynamicsninja/garminconnect-mcp`)

- **A full user guide** in the package README: requirements, a one-time global install (running
  it through `npx` breaks when Claude Desktop starts several copies at once, on any OS), Claude
  Desktop setup for Windows and macOS/Linux, example requests, how workout previews and tool
  approvals work, troubleshooting, updating, and use from other MCP clients such as Claude Code.
- The "not logged in" message now says `garminconnect-mcp login`, matching the guide.
- The server now tells MCP clients its title ("Garmin Connect (unofficial)"), website and an icon.
  Claude Desktop does not show icons for servers added in its config file; other clients may.

## [0.7.0] - 2026-09-29

### Added

- **`@dynamicsninja/garminconnect-mcp`**, a new package in `mcp/`: an MCP server for Claude Desktop. Describe a
  workout in plain English and Claude previews it, saves it, schedules it and sends it to your
  watch; every other library method is available as a tool too. Generated from
  `garminconnect-js/manifest` and released in lockstep with the library. See `mcp/README.md`.
- **`workoutFromSpec(spec, EXERCISES)`**: build a workout from plain JSON (a database row, a form,
  an LLM tool call). It is replayed through `buildWorkout`, so every builder guard applies, and it
  is stricter than the builder: unknown keys and unknown exercise names are rejected with the JSON
  path and the closest valid names. `WORKOUT_SPORTS` is exported alongside it.
- **`WORKOUT_SPEC_JSON_SCHEMA`**: the JSON Schema for `workoutFromSpec`'s input, built from the
  library's own constants so it follows every release.
- **`garminconnect-js/manifest`**: `GARMIN_METHODS`, a generated, machine-readable description of
  every `Garmin` method (JSON Schema parameters, a read/write/destructive safety class, file
  input/output), for building tools on top of this library.

### Fixed

- **A reversed pace range is no longer stored backwards.** `target: { pace: { minPerKm: [5, 4.5] } }`
  put the slower speed first; both orders now store the faster speed in `targetValueOne`.

## [0.6.0] - 2026-09-25

### Changed

- **Exercise names autocomplete and are checked in the workout builder.** A step's `exercise`
  option is now typed `WorkoutExercise` (exported): once `category` is set, `name` offers only that
  category's verified names, and a typo or a name from another category is a compile error,
  previously it compiled, and Garmin silently stored `""`. Type-only: the root bundle's JavaScript
  still carries none of the catalogue. **Breaking for TypeScript callers** passing a name held in a
  plain `string`; check it with `isExerciseName` and cast.
- **Fixed-value parameters are now literal unions instead of `string`**, so they autocomplete:
  `aggregation` on `getFunctionalThresholdPowerRange` and `getLactateThreshold` (`FtpAggregation`),
  on `getRunningTolerance` (`RunningToleranceAggregation`), and `createGear`'s `usageType`
  (`GearUsageType`, either case). These values were already rejected at runtime; now `tsc` catches
  them first.

### Fixed

- **CommonJS TypeScript projects can import the package under `"module": "node16"`.** `exports`
  had one `types` entry ahead of both `import` and `require`, so a CommonJS project resolved the
  ESM `.d.ts` and failed with TS1479 before seeing any of our types. `import` and `require` now
  each carry their own `types` (`.d.ts` / `.d.cts`), for the root and `garminconnect-js/exercises`.
  A new test compiles a real CommonJS and ESM consumer against the built package.
- `npm run smoke:builder`'s strength probe sent the exercise name `"CARDIO"`, which is not a real
  exercise, so Garmin stored its warm-up step with no exercise. The probe only asserted the squat
  step and never noticed; the new type caught it. It now sends `JUMPING_JACKS`.

## [0.5.0] - 2026-09-24

### Added

- **Badge artwork URLs.** Every badge returned by `getEarnedBadges`, `getAvailableBadges`,
  `getInProgressBadges` and `getBadgeDetail` (including each of its `relatedBadges`) now carries
  `badgeImageUrls: { small, large }`. Garmin sends no image URL; these are built the way Garmin
  Connect's web app builds them, from `badgeUuid` or else `badgeId`, and point at public PNGs.
  Live-verified: all 732 URLs for 366 badges on a real account loaded. New exported type
  `BadgeImageUrls`.

### Changed

- Those four methods now return copies of Garmin's badge objects with that one field added,
  rather than the parsed response untouched. No existing field changes.

## [0.4.0] - 2026-09-24

### Added

- **`getBadgeDetail(badgeId)`**: one badge in full, from `/badge-service/badge/detail/v3/{id}`
  (the request Garmin Connect's web app makes when a badge is opened; upstream has no equivalent).
  Adds the rest of the badge's series (`relatedBadges`, each with `earnedByMe`) and the activity
  that earned it (`badgeAssocDataId`/`badgeAssocDataName`). Works for badges you haven't earned.
  New exported types `BadgeDetail` and `RelatedBadge`; the `BadgeDetail` docs note where Garmin's
  web app gets badge descriptions and artwork, which this endpoint does not return.

## [0.3.1] - 2026-09-24

### Fixed

- **A blocked token refresh no longer signs the user out.** The saved tokens are cleared only when
  the OAuth2 refresh is rejected with HTTP 401. A 403 (typically Cloudflare blocking the request)
  or an HTML challenge page still throws `GarminAuthError`, but keeps the stored tokens, so the
  next call simply retries the refresh.

## [0.3.0] - 2026-09-24

### Added

- **Widget sign-in fallback.** When Garmin rate limits the mobile SSO login (HTTP 429 on the
  mobile sign-in page or on `/mobile/api/login`, or a 429 inside a 200 JSON reply from
  `/mobile/api/login`), `login()` signs in through the SSO web widget instead and returns the same
  tokens. The verification-code step works on this path too. Widget failures other than a
  rejected password (`SSO error: ...`) or a rate limit start with `Mobile login rate limited; `.
  New option `GarminClientOptions.loginDelayMs` (pause before the widget's credential POST;
  default 3–8 s).

### Changed

- `MfaState` is now a union on `flow` (`"mobile"` or `"widget"`); mobile states carry
  `flow: "mobile"`, and states without `flow` still resume as mobile. TypeScript code that reads
  `mfaState.loginParams` must check `flow` first. New exported types `MobileMfaState` and
  `WidgetMfaState`.

## [0.2.0] - 2026-09-24

### Added

- **Courses**, eight methods with no python-garminconnect equivalent: `listCourses`, `getCourse`,
  `importCourseGpx`, `createCourse`, `createCourseFromGpx`, `updateCourse`, `deleteCourse` and
  `downloadCourseGpx`. All live-verified by create, read back, update, read back, export and
  delete. A course created moments ago can answer HTTP 429 "not yet ready" to an update or delete;
  a course in open water never becomes ready for updates.

## [0.1.0] - 2026-09-24

First release. A TypeScript client for Garmin Connect, for Node and Next.js server runtimes.

### Added

- **156 methods** covering 151 of python-garminconnect's 154 public methods, plus five that go
  beyond it. Every method's live-verification status is recorded per method in
  [`AGENTS.md`](AGENTS.md); most were confirmed against a real Garmin account by writing a value
  and reading it back, not by accepting a 2xx.
- **`buildWorkout`**, a fluent workout builder with no upstream equivalent. Garmin's workout JSON
  has four traps that produce a silently wrong workout rather than an error, global `stepOrder`
  numbering, id/key triples that must agree, rests measured in the wrong field, and pace targets
  expressed as descending metres per second. See [`WORKOUTS.md`](WORKOUTS.md).
- **`garminconnect-js/exercises`**, a separate entry point holding all 1830 verified exercise
  names across 51 categories. Garmin stores an unrecognised exercise name as `""` and returns
  success; this makes that a compile error. Importing the package root pulls in none of it.
- **`deleteGear`** and **`setGearActivityDefaults`**, endpoints upstream does not have. The latter
  replaces `set_gear_default`, whose endpoint is dead.
- Resumable MFA: `login()` returns `{ state: "mfa_required", mfaState }` rather than blocking for
  input, so the two halves can live in different HTTP requests.
- A `TokenStore` interface with in-memory and garth-compatible file implementations.
- [`docs/api/`](docs/api/README.md), one generated reference page per category, shipped in the
  package.

### Notes

- `trainingPlanCategory` has at least three values: `STATIC` (Garmin Coach), `ITP` (a plan enrolled
  from Training & Planning) and `PHASED`. `getTrainingPlanById` serves ITP and rejects STATIC,
  its 400 `"Not a phased plan."` names the endpoint path, not a required category.

### Changed from upstream, deliberately

- `getGoals` defaults `start` to **1**, not upstream's 0. Garmin's goal-service is 1-indexed and
  `start=0` silently returns `[]` on an account that has goals.
- Return types follow live responses rather than upstream's documentation. At least seven
  endpoints documented as returning an object actually return an array.

### Not ported

Three upstream methods are deliberately absent, because live evidence showed each can only produce
a broken result. Each is recorded with its reason in `tests/parity.test.ts`.

- `upload_walking_workout`, `upload_hiking_workout`, Garmin has no walking or hiking workout sport
  type. Upstream sends activity-type ids 17/18; Garmin accepts the POST and stores
  `sportTypeId: 0, sportTypeKey: null`. Use `uploadWorkout` with `OTHER` (3) or
  `CARDIO_TRAINING` (6).
- `set_gear_default`: the endpoint 404s against gear that demonstrably exists. Use
  `setGearActivityDefaults`.

### Known limitations

- `getGolfScorecard` and `getGolfShotData` response shapes are unverified, no available account
  has a recorded round. `getGolfShotData` returns an unexplained 410 against a fabricated id.
- EU accounts return `412` on every write until upload consent is granted in Garmin Connect's own
  settings. This is account state, not a library error.
- Login and the first token refresh in each process fetch the OAuth consumer key from
  `thegarth.s3.amazonaws.com`, as `garth` does. If that host is unreachable, login fails.
- `@types/node` is an optional peer dependency: needed only for type-checking against the
  `Buffer` return types, and not installed into consumers' projects automatically.

[Unreleased]: https://github.com/DynamicsNinja/garminconnect-js/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/DynamicsNinja/garminconnect-js/compare/v0.8.2...v0.9.0
[0.8.2]: https://github.com/DynamicsNinja/garminconnect-js/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/DynamicsNinja/garminconnect-js/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/DynamicsNinja/garminconnect-js/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/DynamicsNinja/garminconnect-js/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/DynamicsNinja/garminconnect-js/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/DynamicsNinja/garminconnect-js/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/DynamicsNinja/garminconnect-js/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/DynamicsNinja/garminconnect-js/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/DynamicsNinja/garminconnect-js/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/DynamicsNinja/garminconnect-js/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/DynamicsNinja/garminconnect-js/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/DynamicsNinja/garminconnect-js/releases/tag/v0.1.0
