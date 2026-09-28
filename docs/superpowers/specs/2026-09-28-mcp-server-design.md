# garminconnect-mcp — design

Date: 2026-09-28. Status: approved in conversation, awaiting written-spec review.

## 1. Intent

**Goal.** Let a person create Garmin workouts — and use the rest of this library — by talking to
Claude in plain English ("6×400 m at 5k pace with 2 minutes jog, schedule it Thursday, send it to
my watch").

**Who, for now.** The maintainer and a few trusted users, in **Claude Desktop**, each running a
local server with their own Garmin login. A hosted claude.ai connector for strangers is a later
step; this design leaves a seam for it (§4.6) but does not build it.

**Constraints stated by the user.**
- The server relies entirely on `garminconnect-js`; it has no Garmin knowledge of its own.
- It must follow library updates without hand-maintenance.
- Scope is everything the library offers, not just workouts.

**Success criteria.**
1. In Claude Desktop, "create me a <workout>" produces a preview, and on confirmation a workout
   whose STORED document (read back) matches what was described.
2. Every `Garmin` method, minus a short, justified exclusion list, is callable as a tool.
3. Adding or changing a `Garmin` method, or adding an exercise/sport/stroke to the library, reaches
   the MCP tools with zero edits under `mcp/` — and a change that breaks the server fails
   `npm run check` before release.
4. The published `garminconnect-js` still has zero runtime dependencies.

## 2. Architecture

Three units, each usable and testable alone:

| Unit | Location | Depends on | Purpose |
|---|---|---|---|
| `workoutFromSpec` + `WORKOUT_SPEC_JSON_SCHEMA` | `src/workout-spec.ts`, package root export | the builder | JSON in → `WorkoutInput` out, through the real builder |
| Method manifest | `src/generated/manifest.ts`, subpath `garminconnect-js/manifest`; generator `scripts/generate-manifest.ts` | `src/garmin.ts`, AGENTS.md inventory | machine-readable description of every `Garmin` method |
| MCP server | `mcp/` workspace, npm `garminconnect-mcp` | `@modelcontextprotocol/sdk`, `garminconnect-js` (by package name only) | exposes the two units above as MCP tools over stdio |

The library is the single source of truth. The server contains no endpoint, enum or exercise
knowledge; it only adapts library artefacts to MCP.

## 3. Library additions

### 3.1 `workoutFromSpec(spec: WorkoutSpec): WorkoutInput`

A declarative JSON mirror of `buildWorkout`.

```json
{
  "name": "6×400 @ 5k pace",
  "sport": "running",
  "steps": [
    { "type": "warmup", "lapButton": true },
    { "type": "repeat", "times": 6, "steps": [
      { "type": "interval", "distance": 400, "target": { "pace": { "minPerKm": [4.0, 4.2] } } },
      { "type": "recovery", "time": 120 }
    ]},
    { "type": "cooldown", "time": 600 }
  ]
}
```

- **Top level:** `name`, `sport` (`WorkoutSport`), optional `poolLength`, `poolLengthUnit`,
  `sessionTransitionsEnabled`, `estimatedDurationInSecs` (= `WorkoutBuildOptions`), and exactly one
  of `steps` or `legs: [{ sport, steps }]`.
- **Step:** `type` ∈ `warmup | cooldown | interval | recovery | main | other | rest`, plus every
  `StepOptions` field unchanged (end conditions, `target`, `secondaryTarget`, `stroke`, `drill`,
  `equipment`, `exercise`, `weightKg`, `notes`).
- **Blocks:** `{ type: "repeat", times, steps }` and `{ type: "repeatForSeconds", seconds, steps }`,
  nestable.

**Implementation rule: interpret by calling the builder.** `workoutFromSpec` walks the spec and
calls `.warmup()`, `.repeat(n, b => …)`, `.leg()` etc. There is no second encoder; every builder
guard (global `stepOrder`, pace inversion, `gradePercent` secondary refusal, exactly-one end
condition, empty repeat, mixed steps/legs) applies unchanged.

**Stricter than the builder**, because input is LLM-generated rather than type-checked:
- Unknown keys at any level throw `GarminError` naming the JSON path, with a hint when the key is
  a known key in the wrong place (`steps[1].steps[0]: unknown key "pace"; did you mean
  target.pace?`).
- `exercise.name` is checked with `isExerciseName(category, name)`; a miss throws with up to five
  closest valid names for that category (simple edit-distance/substring ranking, no dependency).
- Type errors (string where a number is expected, bad enum value) throw with the path.

**Schema.** `WORKOUT_SPEC_JSON_SCHEMA` (JSON Schema draft 2020-12) is BUILT IN CODE from the same
constants the builder uses — sport keys, stroke/drill/equipment keys, `WORKOUT_EXERCISE_CATEGORIES`
— so a library change to any of them changes the schema. `exercise.name` is `{"type":"string"}`
with a description pointing to `search_exercises`; the 1830 names are deliberately NOT inlined
(~40 KB per turn). A type-level test asserts `WorkoutSpec` step fields equal `StepOptions`, so a new
builder option that the spec does not carry fails `tsc`.

Adds no runtime dependency. Exported from the package root with the `WorkoutSpec` types.

### 3.2 Method manifest

Subpath export `garminconnect-js/manifest`:

```ts
export interface ManifestMethod {
  name: string;                         // "scheduleWorkout"
  category: string;                     // docs:api category slug
  description: string;                  // JSDoc, else AGENTS.md inventory note
  params: { name: string; optional: boolean; schema: JsonSchema }[];
  safety: "read" | "write" | "destructive";
  io: "json" | "binary-in" | "binary-out";
}
export const GARMIN_METHODS: readonly ManifestMethod[];
```

**Generator** `scripts/generate-manifest.ts` (`npm run manifest`, `--check` mode) uses the
TypeScript compiler API on `src/garmin.ts`:
- `string | Date` → `{type:"string", format:"date"}`; `number`, `boolean`, `string` map directly;
  string-literal unions → `enum`; `number | string` ids → `type: ["integer","string"]`.
- Named object types (`CourseInput`, `CourseUpdate`, `ActivityExerciseSets`, `WeightScaleFields`,
  option bags) are expanded structurally; `Record<string, unknown>` → `{type:"object"}`.
- `Blob` parameters mark `io: "binary-in"` (the paired `filename` param is folded in); a `Buffer`
  return marks `io: "binary-out"`.
- **An unmappable type fails the generator** rather than emitting `{}`.
- Category and inventory notes are read the same way `scripts/generate-api-docs.ts` reads them;
  shared parsing is extracted into a helper both scripts import rather than duplicated.

**Safety classification.** By name: `get*`, `list*`, `count*`, `download*` → `read`;
`delete*`, `unschedule*` → `destructive`; else `write`. An explicit override table in the generator
covers exceptions (e.g. `displayName`/`fullName`/`userName`/`unitSystem` → `read`; `requestReload`
→ `write`). **A method matching no rule and absent from the override table fails the generator** —
every new method gets a deliberate decision.

**Drift guard.** Output is committed at `src/generated/manifest.ts`; `tests/manifest.test.ts`
regenerates in memory and fails on any difference, and asserts every `Garmin.prototype` method is
present exactly once. Return types are intentionally not described.

## 4. MCP server — `mcp/`, npm `garminconnect-mcp`

### 4.1 Package

- npm workspace (`"workspaces": ["mcp"]` in the root `package.json`).
- Runtime deps: `@modelcontextprotocol/sdk`, `garminconnect-js`. ESLint rule forbids imports from
  `../src` or any relative path outside `mcp/`.
- Uses the SDK's low-level `Server` so manifest JSON Schemas are passed through verbatim (no zod
  translation layer).
- Transport: stdio. Bin `garminconnect-mcp`:
  - no args → serve;
  - `login` → interactive terminal prompt for email, password and MFA code
    (`client.login` / `resumeLogin`), saving via `FileTokenStore`.
- Node ≥ 18, same as the library.

### 4.2 Hand-written workout tools

| Tool | Behaviour |
|---|---|
| `preview_workout(spec)` | `workoutFromSpec`, returns a human-readable summary; writes nothing |
| `create_workout(spec)` | `workoutFromSpec` → `uploadWorkout`; returns `workoutId` and the summary |
| `update_workout(workoutId, spec)` | `workoutFromSpec` → `updateWorkout` |
| `search_exercises(query, category?)` | ranked matches from `garminconnect-js/exercises`, max 25 |

Input schema of `spec` is `WORKOUT_SPEC_JSON_SCHEMA`. Tool descriptions instruct: preview first,
get the user's confirmation, then create; use `search_exercises` before naming an exercise.

The summary renderer lives in the server (presentation only): e.g.
`Warm-up: until lap · 6× [400 m @ 4:00–4:12/km · recovery 2:00] · Cool-down: 10:00`.

### 4.3 Generated tools

One tool per `GARMIN_METHODS` entry, name = snake_case of the method (`get_sleep_data`).
- `inputSchema`: object built from `params`.
- Annotations: `read` → `readOnlyHint: true`; `destructive` → `destructiveHint: true`;
  `write` → neither.
- `binary-in`: exposed as `filePath` (absolute; extension must be `.fit`, `.gpx` or `.tcx`; must
  exist); the server reads it into a `Blob` and passes the basename as `filename`.
- `binary-out`: bytes written under the download dir as `<method>-<id-or-date>.<ext>`; returns
  `{ path, bytes }`.
- JSON results serialized as text; above 100 000 characters truncated with an explicit
  "[truncated: N of M characters]" marker.

**Exclusions** (kept in one list in `mcp/src/exclusions.ts`, each with a reason, asserted by test):
- `logout` — deletes the saved login; not a chat action.
- `uploadWorkout`, `uploadRunningWorkout`, `uploadCyclingWorkout`, `uploadSwimmingWorkout`,
  `uploadStrengthWorkout`, `updateWorkout` — raw workout JSON bypasses the builder guards;
  replaced by §4.2.
- `queryGarminGraphql` — off unless `GARMIN_MCP_ENABLE_GRAPHQL=1`.

### 4.4 Configuration (environment variables)

| Var | Default | Meaning |
|---|---|---|
| `GARMIN_MCP_TOKEN_DIR` | `~/.garminconnect-mcp/tokens` | `FileTokenStore` directory |
| `GARMIN_MCP_DOWNLOAD_DIR` | `~/Downloads/garmin` | where `binary-out` files go |
| `GARMIN_MCP_GROUPS` | all categories | comma list of manifest categories to expose; workout tools (§4.2) are always on |
| `GARMIN_MCP_ENABLE_GRAPHQL` | off | expose `query_garmin_graphql` |

### 4.5 Errors

Every tool catches and returns `isError: true` with the library's message.
`GarminAuthError` and "no tokens" → "Not logged in or session expired — run
`npx garminconnect-mcp login` in a terminal." `GarminRateLimitError` includes `retryAfter` when
present. Unexpected exceptions return their message, never a stack trace or token.

### 4.6 Seam for a hosted version

All tools obtain the client through `getSession(): Promise<Garmin>`. Today: one cached `Garmin`
over a `FileTokenStore`. A future HTTP transport would supply a per-user implementation backed by
a per-user `TokenStore`; tool code does not change. Nothing else for hosting is built now.

## 5. Staying in sync and releasing

- Root `npm run check` runs typecheck, lint, build and tests for both workspaces.
- The chain: a `Garmin` change → manifest drift test forces regeneration → generated tools change
  → MCP tests run in the same commit. Exercise/enum changes flow through runtime imports and the
  code-built schema.
- **Lockstep versions.** `mcp` version equals the root version and depends on
  `garminconnect-js@^<same version>`; a test fails if they diverge.
- `npm run release` bumps both, publishes the library first, then the server. Releases still
  require the maintainer's explicit go-ahead.

## 6. Testing

- **workout-spec:** parity — every example in `examples/workout-gallery.ts` and `WORKOUTS.md`,
  re-expressed as a spec, deep-equals the builder's output; rejection tests for unknown keys (with
  path and hint), bad exercise names (with suggestions), type errors and each builder guard; all
  spec fixtures validate against `WORKOUT_SPEC_JSON_SCHEMA` with `ajv` (root devDependency only).
- **manifest:** drift test; completeness vs `Garmin.prototype`; safety classes; a fixture proving
  an unclassifiable method name and an unmappable type each fail the generator.
- **mcp:** in-process client via the SDK's in-memory transport, Garmin HTTP mocked through
  `fetchImpl`/msw: tool count = manifest − exclusions (+ 4 workout tools); annotations match
  safety; `create_workout` sends the expected POST body; `GARMIN_MCP_GROUPS` filtering; error
  mapping; truncation; `filePath` restrictions (bad extension, relative path, missing file).
- **live:** `npm run smoke:mcp` (test account only, existing `GARMIN_TEST_PROFILE_ID` gate) drives
  the real server through an MCP client: preview → create → read back with `get_workout_by_id` →
  assert stored sport key and step structure → delete. Success is the stored document, not a 2xx.

## 7. Documentation

- `mcp/README.md`: install, `login`, Claude Desktop `claude_desktop_config.json` snippet, env vars,
  example prompts, the exclusion list.
- `AGENTS.md`: sections for `workoutFromSpec`, `garminconnect-js/manifest`, and the MCP package;
  update `tests/agents-md.test.ts` / `tests/parity.test.ts` expectations where they count exports.
- `WORKOUTS.md`: a short "from JSON" section.
- `CHANGELOG.md`.

## 8. Out of scope

Hosted/HTTP transport and multi-user auth; MCP resources and prompts; describing return types;
any new Garmin endpoint.
