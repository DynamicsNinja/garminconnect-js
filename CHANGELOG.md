# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — unreleased

First release. A TypeScript client for Garmin Connect, for Node and Next.js server runtimes.

### Added

- **156 methods** covering 151 of python-garminconnect's 154 public methods, plus five that go
  beyond it. Every method's live-verification status is recorded per method in
  [`AGENTS.md`](AGENTS.md); most were confirmed against a real Garmin account by writing a value
  and reading it back, not by accepting a 2xx.
- **`buildWorkout`**, a fluent workout builder with no upstream equivalent. Garmin's workout JSON
  has four traps that produce a silently wrong workout rather than an error — global `stepOrder`
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

### Changed from upstream, deliberately

- `getGoals` defaults `start` to **1**, not upstream's 0. Garmin's goal-service is 1-indexed and
  `start=0` silently returns `[]` on an account that has goals.
- Return types follow live responses rather than upstream's documentation. At least seven
  endpoints documented as returning an object actually return an array.

### Not ported

Three upstream methods are deliberately absent, because live evidence showed each can only produce
a broken result. Each is recorded with its reason in `tests/parity.test.ts`.

- `upload_walking_workout`, `upload_hiking_workout` — Garmin has no walking or hiking workout sport
  type. Upstream sends activity-type ids 17/18; Garmin accepts the POST and stores
  `sportTypeId: 0, sportTypeKey: null`. Use `uploadWorkout` with `OTHER` (3) or
  `CARDIO_TRAINING` (6).
- `set_gear_default` — the endpoint 404s against gear that demonstrably exists. Use
  `setGearActivityDefaults`.

### Known limitations

- `getGolfScorecard` and `getGolfShotData` response shapes are unverified — no available account
  has a recorded round. `getGolfShotData` returns an unexplained 410 against a fabricated id.
- EU accounts return `412` on every write until upload consent is granted in Garmin Connect's own
  settings. This is account state, not a library error.

[Unreleased]: https://github.com/DynamicsNinja/garminconnect-js/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/DynamicsNinja/garminconnect-js/releases/tag/v0.1.0
