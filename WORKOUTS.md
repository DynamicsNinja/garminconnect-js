# Building workouts

`buildWorkout` is a fluent builder for Garmin workout templates. It ships with the package and is
optional: `uploadWorkout` still accepts raw JSON, and `build()` returns exactly the JSON you would
otherwise write by hand.

Every shape in this guide is **live-verified** — built, uploaded to a real Garmin account, read back
and compared against what Garmin stored. The examples are lifted from `scripts/smoke-builder.ts`,
which runs all twelve sports on every check.

```ts
import { GarminClient, Garmin, FileTokenStore, buildWorkout } from "garminconnect-js";

const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
await client.loadTokens();
const garmin = new Garmin(client);

const workout = buildWorkout("Threshold 100s", { sport: "swimming", poolLength: 25 })
  .warmup({ distance: 400, stroke: "free" })
  .rest({ lapButton: true })
  .repeat(8, (set) => set.interval({ distance: 100, stroke: "free", drill: "kick" }).rest(15))
  .cooldown({ distance: 200, stroke: "any_stroke" })
  .build();

await garmin.uploadWorkout(workout);
```

---

## Why it exists

Garmin's workout JSON has four traps. Each one is silent — the request succeeds and the workout
looks fine until you read it back or load it on a watch.

| Trap | Hand-written JSON | With the builder |
|---|---|---|
| `stepOrder` is **global** and keeps counting *through* a repeat's children | Numbering each block from 1 gets `400 "The workout steps need to have unique step orders"` | One counter for the whole tree; you never write a `stepOrder` |
| Every enum needs a matching **id + key + displayOrder** | Nothing stops you pairing `stepTypeId: 3` with `stepTypeKey: "warmup"` | Paired from the live enums — a typo is a compile error |
| A rest in seconds is `fixed.rest`, **not** `time` | Easy to reach for `time` and get subtly wrong behaviour on the watch | `.rest(15)` picks `fixed.rest` |
| Pace targets are **descending speeds in m/s** | "5:00–5:30 per km" is `[3.33, 3.03]`, faster first | `target: { pace: { minPerKm: [5, 5.5] } }` |

---

## Starting a workout

```ts
buildWorkout(name, {
  sport,                       // required — see the sports table below
  poolLength,                  // swim only, e.g. 25
  poolLengthUnit,              // "meter" (default) | "yard"
  sessionTransitionsEnabled,   // multi-sport only — the designer's "Transitions" toggle
  estimatedDurationInSecs,     // optional; Garmin recalculates it anyway
})
```

### Sports

`running` · `cycling` · `swimming` · `strength_training` · `cardio_training` · `hiit` · `yoga` ·
`pilates` · `mobility` · `rucking` · `other` · `multi_sport`

> **Walking and hiking are deliberately absent.** Garmin has no workout sport type for either. The
> library's `uploadWalkingWorkout`/`uploadHikingWorkout` exist for upstream parity but store
> `sportTypeKey: null` — a workout with no sport. For a walk or hike template, use `other` or
> `cardio_training`.

---

## Steps

`.warmup()` · `.interval()` · `.recovery()` · `.rest()` · `.cooldown()` · `.main()` · `.other()`

Every step takes **exactly one end condition**:

| Option | Unit | Stored as |
|---|---|---|
| `distance` | metres | `distance` |
| `time` | seconds | `time` |
| `reps` | count | `reps` |
| `lapButton: true` | — | `lap.button` |
| `restSeconds` | seconds | `fixed.rest` |
| `calories` | kcal | `calories` |
| `heartRateBpm` | bpm | `heart.rate` |
| `powerWatts` | watts | `power` |
| `fixedRepetition` | pool lengths | `fixed.repetition` |

Supplying none, or more than one, throws `GarminError` before anything is sent.

`.rest(15)` is shorthand for `.rest({ restSeconds: 15 })`. If you genuinely want a `time` condition
on a rest, say so: `.rest({ time: 15 })`.

Other per-step options: `notes`, plus the sport-specific ones below.

---

## Targets

Pass `target`, and optionally `secondaryTarget` for a second simultaneous one.

```ts
.interval({
  time: 480,
  target: { powerZone: 3 },
  secondaryTarget: { cadence: [85, 95] },   // hold a power zone AND a cadence range
})
```

| Target | Example | Notes |
|---|---|---|
| `pace` | `{ pace: { minPerKm: [4.5, 5] } }` | Also `minPerMile`. Faster bound first, as you'd say it |
| `speedMetresPerSecond` | `{ speedMetresPerSecond: [3.3, 3.0] }` | The raw form, if you prefer it |
| `powerZone` | `{ powerZone: 3 }` | A configured zone → `zoneNumber` |
| `powerWatts` | `{ powerWatts: [200, 250] }` | An explicit range → value pair |
| `heartRateZone` | `{ heartRateZone: 2 }` | A configured zone → `zoneNumber` |
| `heartRateBpm` | `{ heartRateBpm: [140, 155] }` | An explicit range → value pair |
| `cadence` | `{ cadence: [176, 184] }` | |
| `gradePercent` | `{ gradePercent: [2, 5] }` | |
| `resistance` | `{ resistance: [4, 7] }` | Trainer resistance |
| `swimCssOffsetSeconds` | `{ swimCssOffsetSeconds: 5 }` | Seconds from critical swim speed |

Power and heart rate each have **two forms under the same target key** — a configured zone, or an
explicit range. Both are verified; pick whichever you mean.

> **`gradePercent` works as a primary target only.** As a `secondaryTarget`, Garmin stores its first
> value multiplied by ten and leaves the second alone — `[2, 5]` reads back as `[20, 5]`. Verified
> over six pairs. The builder throws rather than send a value it knows will be mangled; dividing by
> ten to compensate would break the day Garmin fixes it. Use grade as the primary `target`.

> **Naming overlap worth knowing.** At the top level of a step, `heartRateBpm` and `powerWatts` are
> single numbers and mean *end conditions*. Inside `target`, they are ranges and mean *targets*.

---

## Repeats

```ts
.repeat(4, (set) => set.interval({ distance: 400 }).recovery({ time: 90 }))
```

For an AMRAP-style block that runs for a fixed time instead of a fixed count:

```ts
.repeatForSeconds(600, (set) => set.interval({ reps: 10 }).rest(30))
```

Repeats nest, including a count-based one inside a time-based one:

```ts
.repeatForSeconds(600, (set) =>
  set
    .interval({ reps: 10, exercise: { category: "PUSH_UP" } })
    .repeat(2, (inner) => inner.interval({ time: 30, exercise: { category: "PLANK" } }).rest(15)),
)
```

---

## Sport-specific options

### Swimming

Pool length goes on the **workout**; stroke, drill and equipment go on the **step**.

| Option | Values |
|---|---|
| `stroke` | `any_stroke` `backstroke` `breaststroke` `drill` `fly` `free` `individual_medley` `mixed` `individual_medley_by_round` `reverse_individual_medley_by_round` |
| `drill` | `kick` `pull` `drill` |
| `equipment` | `fins` `kickboard` `paddles` `pull_buoy` `snorkel` |

### Strength and HIIT

```ts
.interval({ reps: 8, exercise: { category: "SQUAT", name: "BARBELL_BACK_SQUAT" }, weightKg: 60 })
```

`category` alone is accepted; `name` is optional. Both are Garmin's SCREAMING_SNAKE_CASE keys, not
the display names the web UI shows — "Barbell Overhead Press" is stored as
`category: "SHOULDER_PRESS", exerciseName: "OVERHEAD_BARBELL_PRESS"`. Garmin's picker has 548
exercises; the reliable way to find a `name` is to build one step in the web designer and read the
workout back.

**`category` is type-constrained**, because an invalid one fails the **whole upload** with
`400 "Invalid category"` — not just the offending step — and no endpoint lists the valid values.
They were determined exhaustively against a live account by submitting each candidate alone.

The accepted set is exactly the **FIT SDK `exercise_category` enum** plus **six Garmin Connect
additions** — 40 in total, exported as `WORKOUT_EXERCISE_CATEGORIES`:

```
BENCH_PRESS  CALF_RAISE  CARDIO  CARRY  CHOP  CORE  CRUNCH  CURL  DEADLIFT  FLYE
HIP_RAISE  HIP_STABILITY  HIP_SWING  HYPEREXTENSION  LATERAL_RAISE  LEG_CURL  LEG_RAISE
LUNGE  OLYMPIC_LIFT  PLANK  PLYO  PULL_UP  PUSH_UP  ROW  SHOULDER_PRESS
SHOULDER_STABILITY  SHRUG  SIT_UP  SQUAT  TOTAL_BODY  TRICEPS_EXTENSION  WARM_UP  RUN
UNKNOWN                                                        ← the FIT enum ends here
BIKE  STRETCH  BANDED_EXERCISES  BATTLE_ROPE  SLED  SUSPENSION ← Garmin Connect additions
```

49 other plausible names were tested and **all rejected**, including the ones you are most likely to
reach for:

| Rejected | Why it surprises |
|---|---|
| `COOL_DOWN` | `WARM_UP` is valid — the pair is asymmetric |
| `YOGA` `PILATES` `MOBILITY` | These are *sports*, not exercise categories |
| `BURPEE` `KETTLEBELL` `MOUNTAIN_CLIMBER` `JUMP_ROPE` | Common movements, but not categories |
| `CHEST` `LEGS` `ABS` `BICEPS` | Muscle groups are not categories |
| `CLEAN` `SNATCH` `THRUSTER` | Specific lifts belong in `name`, under `OLYMPIC_LIFT` |

Because the type is a union, a wrong category is a **compile error** rather than a failed upload.
If Garmin adds one before this library catches up, cast it: `category: "NEW_ONE" as ExerciseCategory`.

### Multi-sport

Each leg becomes its own segment with its own sport. Using `.leg()` switches the workout to
`multi_sport`; you cannot mix legs with steps added directly.

```ts
buildWorkout("Brick", { sport: "multi_sport", sessionTransitionsEnabled: true })
  .leg("swimming", (l) => l.warmup({ distance: 400, stroke: "free" }))
  .leg("cycling", (l) =>
    l.repeat(3, (r) => r.interval({ time: 480, target: { powerZone: 2 } }).recovery({ time: 120 })),
  )
  .leg("running", (l) => l.interval({ distance: 5000, target: { pace: { minPerKm: [5, 5.5] } } }))
  .build();
```

---

## Worked examples

### Running intervals with a secondary cadence target

```ts
buildWorkout("4 x 1 km", { sport: "running" })
  .warmup({ time: 600, target: { heartRateZone: 2 }, notes: "easy" })
  .repeat(4, (set) =>
    set
      .interval({
        distance: 1000,
        target: { pace: { minPerKm: [4.5, 5] } },
        secondaryTarget: { cadence: [176, 184] },
      })
      .recovery({ time: 120, target: { heartRateBpm: [120, 140] } }),
  )
  .cooldown({ lapButton: true })
  .build();
```

### Cycling, power zones plus cadence

```ts
buildWorkout("Sweet spot", { sport: "cycling" })
  .warmup({ time: 600, target: { resistance: [2, 4] } })
  .repeat(3, (set) =>
    set
      .interval({ time: 480, target: { powerZone: 3 }, secondaryTarget: { cadence: [85, 95] } })
      .recovery({ time: 240, target: { powerWatts: [120, 160] } }),
  )
  .cooldown({ time: 300 })
  .build();
```

### A full swim set

```ts
buildWorkout("Mixed set", { sport: "swimming", poolLength: 25 })
  .warmup({ distance: 400, stroke: "free", notes: "build" })
  .rest({ lapButton: true })
  .repeat(8, (set) =>
    set
      .interval({ distance: 100, stroke: "free", drill: "kick", target: { swimCssOffsetSeconds: 5 } })
      .rest(15),
  )
  .repeat(4, (set) => set.interval({ distance: 50, stroke: "fly", equipment: "paddles" }).rest(20))
  .repeat(2, (set) =>
    set.interval({ fixedRepetition: 4, stroke: "individual_medley", equipment: "fins" }).rest(30),
  )
  .interval({ distance: 200, stroke: "backstroke", drill: "pull", equipment: "pull_buoy" })
  .cooldown({ distance: 200, stroke: "any_stroke" })
  .build();
```

### Strength with nested sets

```ts
buildWorkout("Lower body", { sport: "strength_training" })
  .warmup({ time: 300, exercise: { category: "CARDIO", name: "CARDIO" } })
  .repeat(3, (set) =>
    set
      .interval({ reps: 8, exercise: { category: "SQUAT", name: "BARBELL_BACK_SQUAT" }, weightKg: 60 })
      .rest(90),
  )
  .repeat(4, (set) =>
    set
      .interval({ reps: 10, exercise: { category: "BENCH_PRESS", name: "BARBELL_BENCH_PRESS" }, weightKg: 40 })
      .interval({ reps: 12, exercise: { category: "ROW", name: "BARBELL_ROW" }, weightKg: 35 })
      .rest(120),
  )
  .interval({ reps: 20, exercise: { category: "PLANK" } })
  .cooldown({ lapButton: true })
  .build();
```

### Cardio circuit

Three rounds of four stations, each a different exercise.

```ts
buildWorkout("Circuit", { sport: "cardio_training" })
  .warmup({ time: 300, exercise: { category: "WARM_UP" } })
  .repeat(3, (round) =>
    round
      .interval({ time: 45, exercise: { category: "PUSH_UP" }, notes: "station 1" })
      .rest(15)
      .interval({ time: 45, exercise: { category: "SQUAT" }, notes: "station 2" })
      .rest(15)
      .interval({ time: 45, exercise: { category: "PLANK" }, notes: "station 3" })
      .rest(15)
      .interval({ time: 45, exercise: { category: "LUNGE" }, notes: "station 4" })
      .rest(60),
  )
  .cooldown({ time: 300, target: { heartRateZone: 1 } })
  .build();
```

### Yoga flow

No `exercise` field — `YOGA` is not a valid category. The sport is yoga; each step is a timed
segment with the pose in `notes`.

```ts
buildWorkout("Morning flow", { sport: "yoga" })
  .warmup({ time: 180, notes: "child's pose, breathing" })
  .repeat(3, (round) =>
    round
      .interval({ time: 60, notes: "sun salutation A" })
      .interval({ time: 60, notes: "sun salutation B" })
      .rest(30),
  )
  .repeat(2, (side) =>
    side
      .interval({ time: 45, notes: "warrior II — hold" })
      .interval({ time: 45, notes: "triangle — hold" })
      .rest(20),
  )
  .cooldown({ time: 300, notes: "savasana" })
  .build();
```

### Pilates — timed holds mixed with rep counts

```ts
buildWorkout("Mat pilates", { sport: "pilates" })
  .warmup({ time: 240, notes: "breathing and alignment" })
  .repeat(2, (set) =>
    set
      .interval({ reps: 20, exercise: { category: "CRUNCH" }, notes: "the hundred" })
      .interval({ time: 60, exercise: { category: "PLANK" } })
      .interval({ reps: 15, exercise: { category: "LEG_RAISE" }, notes: "single leg circles" })
      .rest(45),
  )
  .interval({ reps: 12, exercise: { category: "HIP_RAISE" }, notes: "shoulder bridge" })
  .cooldown({ time: 180, notes: "spine stretch" })
  .build();
```

### Mobility — holds per side

```ts
buildWorkout("Hips and thoracic", { sport: "mobility" })
  .warmup({ time: 120, notes: "easy movement" })
  .repeat(2, (side) =>
    side
      .interval({ time: 45, exercise: { category: "STRETCH" }, notes: "90/90 hip — left" })
      .interval({ time: 45, exercise: { category: "STRETCH" }, notes: "90/90 hip — right" })
      .interval({ time: 60, exercise: { category: "STRETCH" }, notes: "thoracic opener" })
      .rest(30),
  )
  .cooldown({ time: 120, notes: "breathe" })
  .build();
```

### Rucking

Garmin has no per-workout load field, so the pack weight goes in the name and `notes`; effort is
controlled with heart-rate and grade targets.

```ts
buildWorkout("20 kg ruck", { sport: "rucking" })
  .warmup({ distance: 800, target: { heartRateZone: 1 }, notes: "20 kg pack — settle in" })
  .repeat(4, (leg) =>
    leg
      .interval({ distance: 1600, target: { heartRateZone: 3 }, notes: "sustained" })
      .recovery({ time: 180, target: { heartRateBpm: [110, 130] } }),
  )
  .interval({ distance: 1000, target: { gradePercent: [4, 8] }, notes: "hill section" })
  .cooldown({ distance: 800, target: { heartRateZone: 1 } })
  .build();
```

### A lap-button-driven open session

Useful when the structure is in your head and you just want the watch to count laps.

```ts
buildWorkout("Open session", { sport: "other" })
  .warmup({ lapButton: true, notes: "press lap when ready" })
  .repeat(5, (block) => block.interval({ lapButton: true }).rest({ lapButton: true }))
  .cooldown({ lapButton: true })
  .build();
```

---

## Errors

`build()` and the step methods throw `GarminError` before anything reaches the network for:

- a step with no end condition, or with more than one
- an empty workout, an empty repeat block, or an empty name
- a repeat count that is not a positive whole number
- mixing single-sport steps with multi-sport legs

---

## Raw JSON

The builder is a convenience, not a gate. If you need a field it does not expose — Garmin's
condition and target enums have 24 and 27 entries respectively, and the builder covers the useful
subset — write the JSON yourself and pass it straight to `uploadWorkout`, or build the skeleton and
patch the result:

```ts
const workout = buildWorkout("Custom", { sport: "running" }).interval({ time: 600 }).build();
const step = workout.workoutSegments[0].workoutSteps[0] as Record<string, unknown>;
step["someExoticField"] = 1;
await garmin.uploadWorkout(workout);
```

`WORKOUT_SPORT_TYPE_ID`, `WORKOUT_STEP_TYPE_ID`, `WORKOUT_CONDITION_TYPE_ID`,
`WORKOUT_TARGET_TYPE_ID`, `WORKOUT_STROKE_TYPE_ID`, `WORKOUT_DRILL_TYPE_ID`,
`WORKOUT_EQUIPMENT_TYPE_ID`, `WORKOUT_SWIM_INSTRUCTION_TYPE_ID` and `WORKOUT_INTENSITY_TYPE_ID` are
all exported, and every id in them was read from Garmin's own
`GET /workout-service/workout/types`.
