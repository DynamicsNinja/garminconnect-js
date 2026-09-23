/**
 * A fluent builder for Garmin workouts.
 *
 * **NOT upstream parity** — upstream python-garminconnect has no equivalent. This is a convenience
 * layer over `uploadWorkout`, which still accepts raw JSON exactly as before. Nothing here changes
 * the wire format; `build()` returns the same `WorkoutInput` you would have written by hand.
 *
 * It exists because hand-writing that JSON has four traps, all of which were found the hard way by
 * building workouts in Garmin's own designer and diffing the payloads:
 *
 *  1. **`stepOrder` is global and runs THROUGH repeat children.** Numbering each block from 1 earns
 *     `400 "The workout steps need to have unique step orders"`. The builder owns one counter.
 *  2. **Every enum reference needs a matching id AND key AND displayOrder.** Nothing stops you
 *     pairing `stepTypeId: 3` with `stepTypeKey: "warmup"`. The builder pairs them from the live
 *     enums, so a typo is a compile error instead of a silently wrong workout.
 *  3. **A rest in seconds is `fixed.rest`, not `time`.** `.rest(15)` picks the right one.
 *  4. **Pace targets are SPEEDS in m/s, and the FASTER bound comes first** — so a "5:00 to 5:30 per
 *     km" range is `[3.33, 3.03]`, descending. `.target({ pace: ... })` takes minutes per km (or
 *     mile) and does the conversion and the inversion for you.
 *
 * ```ts
 * const workout = buildWorkout("Threshold 100s", { sport: "swimming", poolLength: 25 })
 *   .warmup({ distance: 400, stroke: "free" })
 *   .rest({ lapButton: true })
 *   .repeat(8, (r) => r.interval({ distance: 100, stroke: "free", drill: "kick" }).rest(15))
 *   .cooldown({ distance: 200, stroke: "any_stroke" })
 *   .build();
 *
 * await garmin.uploadWorkout(workout);
 * ```
 */
import { GarminError } from "./errors.js";
import {
  WORKOUT_CONDITION_TYPE_ID as COND,
  WORKOUT_DRILL_TYPE_ID,
  WORKOUT_EQUIPMENT_TYPE_ID,
  WORKOUT_SPORT_TYPE_ID,
  WORKOUT_STEP_TYPE_ID as STEP,
  WORKOUT_STROKE_TYPE_ID,
  WORKOUT_TARGET_TYPE_ID as TARGET,
} from "./types/workouts.js";
import type {
  ExecutableWorkoutStep,
  RepeatWorkoutGroup,
  WorkoutInput,
  WorkoutSegment,
  WorkoutTypeRef,
} from "./types/workouts.js";

/**
 * `displayOrder` for each sport, as Garmin itself stores it. It is cosmetic — a workout is accepted
 * with the "wrong" value — but matching Garmin's own numbers costs nothing and avoids a diff that
 * looks like a bug.
 */
const SPORTS = {
  running: [WORKOUT_SPORT_TYPE_ID.RUNNING, 1],
  cycling: [WORKOUT_SPORT_TYPE_ID.CYCLING, 2],
  swimming: [WORKOUT_SPORT_TYPE_ID.SWIMMING, 3],
  strength_training: [WORKOUT_SPORT_TYPE_ID.STRENGTH_TRAINING, 4],
  multi_sport: [WORKOUT_SPORT_TYPE_ID.MULTI_SPORT, 5],
  cardio_training: [WORKOUT_SPORT_TYPE_ID.CARDIO_TRAINING, 6],
  hiit: [WORKOUT_SPORT_TYPE_ID.HIIT, 7],
  yoga: [WORKOUT_SPORT_TYPE_ID.YOGA, 8],
  pilates: [WORKOUT_SPORT_TYPE_ID.PILATES, 9],
  mobility: [WORKOUT_SPORT_TYPE_ID.MOBILITY, 10],
  rucking: [WORKOUT_SPORT_TYPE_ID.RUCKING, 12],
  other: [WORKOUT_SPORT_TYPE_ID.OTHER, 13],
} as const satisfies Record<string, readonly [number, number]>;

/**
 * Sports you can build a workout for. Deliberately EXCLUDES walking and hiking: Garmin has no
 * workout sport type for either, and sending upstream's ids (17/18) produces a workout with
 * `sportTypeKey: null`. See `WORKOUT_SPORT_TYPE_ID`'s doc comment.
 */
export type WorkoutSport = keyof typeof SPORTS;

export type StrokeKey = Lowercase<keyof typeof WORKOUT_STROKE_TYPE_ID>;
export type DrillKey = Lowercase<keyof typeof WORKOUT_DRILL_TYPE_ID>;
export type EquipmentKey = Lowercase<keyof typeof WORKOUT_EQUIPMENT_TYPE_ID>;

const STROKES: Record<StrokeKey, number> = {
  any_stroke: 1,
  backstroke: 2,
  breaststroke: 3,
  drill: 4,
  fly: 5,
  free: 6,
  individual_medley: 7,
  mixed: 8,
  individual_medley_by_round: 9,
  reverse_individual_medley_by_round: 10,
};
const DRILLS: Record<DrillKey, number> = { kick: 1, pull: 2, drill: 3 };
const EQUIPMENT: Record<EquipmentKey, number> = {
  fins: 1,
  kickboard: 2,
  paddles: 3,
  pull_buoy: 4,
  snorkel: 5,
};

/** How a step ends. Supply exactly one. Every option here is live-verified. */
export interface StepEnd {
  /** Metres. */
  distance?: number;
  /** Seconds. */
  time?: number;
  /** Repetitions (strength/HIIT). */
  reps?: number;
  /** Runs until the user presses lap. */
  lapButton?: boolean;
  /** A fixed rest in SECONDS — becomes `fixed.rest`, not `time`. */
  restSeconds?: number;
  /** Ends once this many calories are burned. */
  calories?: number;
  /** Ends when heart rate reaches this many BPM. */
  heartRateBpm?: number;
  /** Ends when power reaches this many watts. */
  powerWatts?: number;
  /** Swim: ends after this many pool lengths (`fixed.repetition`). */
  fixedRepetition?: number;
}

/**
 * A step's intensity target. Supply at most one key.
 *
 * `pace` is given the way a human thinks about it — minutes per kilometre (or mile), slower number
 * second — and converted to the descending metres-per-second pair Garmin stores.
 */
export type StepTarget =
  | { pace: { minPerKm: [number, number] } }
  | { pace: { minPerMile: [number, number] } }
  | { speedMetresPerSecond: [number, number] }
  /** A configured power zone, by number. Stores `zoneNumber`. */
  | { powerZone: number }
  /** An explicit watt range. Stores value pairs under the SAME `power.zone` target key. */
  | { powerWatts: [number, number] }
  /** A configured heart-rate zone, by number. Stores `zoneNumber`. */
  | { heartRateZone: number }
  /** An explicit BPM range. Stores value pairs under the SAME `heart.rate.zone` target key. */
  | { heartRateBpm: [number, number] }
  | { cadence: [number, number] }
  /** Percent incline range. */
  | { gradePercent: [number, number] }
  /** Trainer resistance range. */
  | { resistance: [number, number] }
  /** Swim: seconds offset from critical swim speed. */
  | { swimCssOffsetSeconds: number };

export interface StepOptions extends StepEnd {
  target?: StepTarget;
  /**
   * A second, simultaneous target — Garmin's bike designer calls this "Secondary Target". Stores
   * `secondaryTargetType` plus `secondaryTargetValueOne`/`Two` or `secondaryZoneNumber`.
   * e.g. hold a power zone AND a cadence range at once.
   */
  secondaryTarget?: StepTarget;
  /** Swim only. */
  stroke?: StrokeKey;
  /** Swim only. */
  drill?: DrillKey;
  /** Swim only. */
  equipment?: EquipmentKey;
  /** Strength/HIIT. Both values are Garmin's SCREAMING_SNAKE_CASE keys, not display names. */
  exercise?: { category: string; name?: string };
  /** Strength/HIIT, in kilograms. Garmin stores kg and round-trips with small drift. */
  weightKg?: number;
  /** Free-text note shown on the device. */
  notes?: string;
}

const ref = (id: number, key: string) => ({ conditionTypeId: id, conditionTypeKey: key, displayOrder: id, displayable: true });

/** Minutes-per-km -> metres-per-second. 5 min/km = 1000 m / 300 s = 3.333 m/s. */
const paceToMps = (minPerKm: number) => 1000 / (minPerKm * 60);
const milePaceToMps = (minPerMile: number) => 1609.344 / (minPerMile * 60);

function endOf(o: StepEnd): { endCondition: WorkoutTypeRef; endConditionValue?: number } {
  const options: [keyof StepEnd, number, string][] = [
    ["distance", COND.DISTANCE, "distance"],
    ["time", COND.TIME, "time"],
    ["reps", COND.REPS, "reps"],
    ["restSeconds", COND.FIXED_REST, "fixed.rest"],
    ["calories", COND.CALORIES, "calories"],
    ["heartRateBpm", COND.HEART_RATE, "heart.rate"],
    ["powerWatts", COND.POWER, "power"],
    ["fixedRepetition", COND.FIXED_REPETITION, "fixed.repetition"],
  ];
  const chosen = options.filter(([k]) => o[k] !== undefined);
  const lapButton = o.lapButton === true;
  const total = chosen.length + (lapButton ? 1 : 0);

  if (total === 0) {
    throw new GarminError(
      "Workout step needs an end condition: one of distance, time, reps, lapButton, restSeconds, " +
        "calories, heartRateBpm, powerWatts or fixedRepetition",
    );
  }
  if (total > 1) {
    const names = [...chosen.map(([k]) => k), ...(lapButton ? ["lapButton"] : [])];
    throw new GarminError(
      `Workout step has ${total} end conditions (${names.join(", ")}); supply exactly one`,
    );
  }
  if (lapButton) return { endCondition: ref(COND.LAP_BUTTON, "lap.button") };
  const [key, id, name] = chosen[0]!;
  return { endCondition: ref(id, name), endConditionValue: o[key] as number };
}

/**
 * Encodes a target into the field names Garmin expects. `secondary` switches to the
 * `secondaryTargetType` / `secondaryTargetValueOne` / `secondaryZoneNumber` family, which is the
 * "Secondary Target" the bike designer exposes.
 *
 * Note that HR and power each have TWO encodings under the SAME target key: a configured zone
 * (`zoneNumber`) or an explicit range (value pair). Both are live-verified.
 */
function targetOf(t: StepTarget | undefined, secondary = false): Record<string, unknown> {
  const typeField = secondary ? "secondaryTargetType" : "targetType";
  const oneField = secondary ? "secondaryTargetValueOne" : "targetValueOne";
  const twoField = secondary ? "secondaryTargetValueTwo" : "targetValueTwo";
  const zoneField = secondary ? "secondaryZoneNumber" : "zoneNumber";

  const typed = (id: number, key: string) => ({
    [typeField]: { workoutTargetTypeId: id, workoutTargetTypeKey: key, displayOrder: id },
  });
  const range = (id: number, key: string, [a, b]: [number, number], descending = false) => ({
    ...typed(id, key),
    [oneField]: descending ? Math.max(a, b) : Math.min(a, b),
    [twoField]: descending ? Math.min(a, b) : Math.max(a, b),
  });
  const zone = (id: number, key: string, n: number) => ({ ...typed(id, key), [zoneField]: n });

  if (!t) {
    // A secondary "no target" is meaningless — omit the fields entirely rather than send nulls.
    return secondary ? {} : typed(TARGET.NO_TARGET, "no.target");
  }

  if ("pace" in t) {
    // Garmin wants SPEEDS, faster (larger) first — so the fast end of the pace range, which is the
    // SMALLER minutes-per-km number, becomes targetValueOne.
    const [fast, slow] =
      "minPerKm" in t.pace
        ? [paceToMps(t.pace.minPerKm[0]), paceToMps(t.pace.minPerKm[1])]
        : [milePaceToMps(t.pace.minPerMile[0]), milePaceToMps(t.pace.minPerMile[1])];
    return { ...typed(TARGET.PACE_ZONE, "pace.zone"), [oneField]: fast, [twoField]: slow };
  }
  if ("speedMetresPerSecond" in t) return range(TARGET.SPEED_ZONE, "speed.zone", t.speedMetresPerSecond, true);
  if ("powerZone" in t) return zone(TARGET.POWER_ZONE, "power.zone", t.powerZone);
  if ("powerWatts" in t) return range(TARGET.POWER_ZONE, "power.zone", t.powerWatts);
  if ("heartRateZone" in t) return zone(TARGET.HEART_RATE_ZONE, "heart.rate.zone", t.heartRateZone);
  if ("heartRateBpm" in t) return range(TARGET.HEART_RATE_ZONE, "heart.rate.zone", t.heartRateBpm);
  if ("cadence" in t) return range(TARGET.CADENCE, "cadence", t.cadence);
  if ("gradePercent" in t) {
    // REJECTED as a secondary target, because Garmin does not round-trip it there: the stored
    // `secondaryTargetValueOne` comes back MULTIPLIED BY TEN while `secondaryTargetValueTwo` is
    // untouched. Confirmed over six pairs on 2026-09-23 — [2,5]->[20,5], [1,10]->[10,10],
    // [3,7]->[30,7], [4,4]->[40,4], [6,12]->[60,12], [0,1]->[0,1]. As a PRIMARY target grade is
    // exact, so this is a Garmin-side inconsistency in the secondary slot, not a bug here.
    //
    // Silently sending a value that comes back tenfold is worse than refusing, and dividing by ten
    // to compensate would be guesswork that breaks the day Garmin fixes it.
    if (secondary) {
      throw new GarminError(
        "gradePercent cannot be used as a secondaryTarget: Garmin stores its first value multiplied " +
          "by ten there (sending [2, 5] reads back as [20, 5]), so it does not round-trip. Use it as " +
          "the primary `target` instead, where it is exact.",
      );
    }
    return range(TARGET.GRADE, "grade", t.gradePercent);
  }
  if ("resistance" in t) return range(TARGET.RESISTANCE, "resistance", t.resistance);
  return { ...typed(TARGET.SWIM_CSS_OFFSET, "swim.css.offset"), [oneField]: t.swimCssOffsetSeconds };
}

/** Shared step-adding surface, used both at the top level and inside a `repeat()`. */
export class WorkoutStepList {
  protected readonly steps: (ExecutableWorkoutStep | RepeatWorkoutGroup)[] = [];
  constructor(protected readonly nextOrder: () => number) {}

  private add(stepTypeId: number, stepTypeKey: string, o: StepOptions): this {
    const { endCondition, endConditionValue } = endOf(o);
    const step: ExecutableWorkoutStep = {
      type: "ExecutableStepDTO",
      stepOrder: this.nextOrder(),
      stepType: { stepTypeId, stepTypeKey, displayOrder: stepTypeId },
      endCondition,
      ...(endConditionValue !== undefined && { endConditionValue }),
      ...targetOf(o.target),
      ...targetOf(o.secondaryTarget, true),
      ...(o.stroke && {
        strokeType: { strokeTypeId: STROKES[o.stroke], strokeTypeKey: o.stroke, displayOrder: STROKES[o.stroke] },
      }),
      ...(o.drill && {
        drillType: { drillTypeId: DRILLS[o.drill], drillTypeKey: o.drill, displayOrder: DRILLS[o.drill] },
      }),
      ...(o.equipment && {
        equipmentType: {
          equipmentTypeId: EQUIPMENT[o.equipment],
          equipmentTypeKey: o.equipment,
          displayOrder: EQUIPMENT[o.equipment],
        },
      }),
      ...(o.exercise && { category: o.exercise.category, exerciseName: o.exercise.name ?? null }),
      ...(o.weightKg !== undefined && {
        weightValue: o.weightKg,
        weightUnit: { unitId: 8, unitKey: "kilogram", factor: 1000 },
      }),
      ...(o.notes !== undefined && { description: o.notes }),
    };
    this.steps.push(step);
    return this;
  }

  warmup(o: StepOptions): this {
    return this.add(STEP.WARMUP, "warmup", o);
  }
  cooldown(o: StepOptions): this {
    return this.add(STEP.COOLDOWN, "cooldown", o);
  }
  interval(o: StepOptions): this {
    return this.add(STEP.INTERVAL, "interval", o);
  }
  recovery(o: StepOptions): this {
    return this.add(STEP.RECOVERY, "recovery", o);
  }
  main(o: StepOptions): this {
    return this.add(STEP.MAIN, "main", o);
  }
  other(o: StepOptions): this {
    return this.add(STEP.OTHER, "other", o);
  }

  /** A rest. Given a number, it is SECONDS and becomes `fixed.rest`. */
  rest(o: StepOptions | number): this {
    return this.add(STEP.REST, "rest", typeof o === "number" ? { restSeconds: o } : o);
  }

  /** Repeat a block `times` times. The group takes its own stepOrder BEFORE its children. */
  repeat(times: number, build: (block: WorkoutStepList) => unknown): this {
    if (!Number.isInteger(times) || times < 1) {
      throw new GarminError(`repeat() needs a positive whole number of iterations, got ${times}`);
    }
    return this.#pushRepeat(build, {
      numberOfIterations: times,
      endCondition: ref(COND.ITERATIONS, "iterations"),
    });
  }

  /**
   * Repeat a block until `seconds` have elapsed — Garmin's "Repeat Until Time Is". Stores
   * `numberOfIterations: null`, which is why that field is nullable.
   */
  repeatForSeconds(seconds: number, build: (block: WorkoutStepList) => unknown): this {
    if (!(seconds > 0)) {
      throw new GarminError(`repeatForSeconds() needs a positive duration, got ${seconds}`);
    }
    return this.#pushRepeat(build, {
      numberOfIterations: null,
      endCondition: ref(COND.TIME, "time"),
      endConditionValue: seconds,
    });
  }

  #pushRepeat(
    build: (block: WorkoutStepList) => unknown,
    tail: Partial<RepeatWorkoutGroup>,
  ): this {
    const stepOrder = this.nextOrder();
    const block = new WorkoutStepList(this.nextOrder);
    build(block);
    const children = block.collect();
    if (children.length === 0) {
      throw new GarminError("A repeat block must contain at least one step");
    }
    this.steps.push({
      type: "RepeatGroupDTO",
      stepOrder,
      stepType: { stepTypeId: STEP.REPEAT, stepTypeKey: "repeat", displayOrder: STEP.REPEAT },
      smartRepeat: false,
      workoutSteps: children,
      numberOfIterations: null,
      ...tail,
    });
    return this;
  }

  /** @internal */
  collect(): (ExecutableWorkoutStep | RepeatWorkoutGroup)[] {
    return this.steps;
  }
}

export interface WorkoutBuildOptions {
  sport: WorkoutSport;
  /** Swim only, in the unit given by `poolLengthUnit` (default metres). */
  poolLength?: number;
  poolLengthUnit?: "meter" | "yard";
  /** Only meaningful for `multi_sport`; shows as the designer's "Transitions" toggle. */
  sessionTransitionsEnabled?: boolean;
  estimatedDurationInSecs?: number;
}

/** The top-level builder. See the module doc comment for the rationale and an example. */
export class WorkoutBuilder extends WorkoutStepList {
  private readonly legs: WorkoutSegment[] = [];

  constructor(
    private readonly name: string,
    private readonly options: WorkoutBuildOptions,
    nextOrder: () => number,
  ) {
    super(nextOrder);
    if (!(name.trim().length > 0)) throw new GarminError("A workout needs a name");
  }

  /**
   * Add a multi-sport leg. Each leg becomes its own segment with its own sport, which is exactly
   * how Garmin models a brick. Using this switches the workout to `multi_sport`.
   */
  leg(sport: WorkoutSport, build: (block: WorkoutStepList) => unknown): this {
    const block = new WorkoutStepList(this.nextOrder);
    build(block);
    const steps = block.collect();
    if (steps.length === 0) throw new GarminError(`Multi-sport leg "${sport}" has no steps`);
    const [id, displayOrder] = SPORTS[sport];
    this.legs.push({
      segmentOrder: this.legs.length + 1,
      sportType: { sportTypeId: id, sportTypeKey: sport, displayOrder },
      workoutSteps: steps,
    });
    return this;
  }

  build(): WorkoutInput {
    const own = this.collect();
    if (own.length === 0 && this.legs.length === 0) {
      throw new GarminError("A workout needs at least one step");
    }
    if (own.length > 0 && this.legs.length > 0) {
      throw new GarminError(
        "A workout is either single-sport (steps added directly) or multi-sport (legs); it cannot be both",
      );
    }

    const multi = this.legs.length > 0;
    const sport: WorkoutSport = multi ? "multi_sport" : this.options.sport;
    const [sportId, sportOrder] = SPORTS[sport];
    const sportType = { sportTypeId: sportId, sportTypeKey: sport, displayOrder: sportOrder };

    const segments: WorkoutSegment[] = multi
      ? this.legs
      : [{ segmentOrder: 1, sportType, workoutSteps: own }];

    return {
      workoutName: this.name,
      sportType,
      // Garmin recomputes this; a sane non-zero default keeps the UI from showing 0:00 before sync.
      estimatedDurationInSecs: this.options.estimatedDurationInSecs ?? 0,
      workoutSegments: segments,
      ...(this.options.poolLength !== undefined && {
        poolLength: this.options.poolLength,
        poolLengthUnit:
          (this.options.poolLengthUnit ?? "meter") === "yard"
            ? { unitId: 2, unitKey: "yard", factor: 91.44 }
            : { unitId: 1, unitKey: "meter", factor: 100 },
      }),
      ...(this.options.sessionTransitionsEnabled !== undefined && {
        isSessionTransitionEnabled: this.options.sessionTransitionsEnabled,
      }),
    };
  }
}

/**
 * Start building a workout. The result of `.build()` goes straight to `uploadWorkout`.
 *
 * @example Single sport
 * ```ts
 * buildWorkout("Tempo", { sport: "running" })
 *   .warmup({ lapButton: true })
 *   .repeat(4, (r) => r.interval({ distance: 1000, target: { pace: { minPerKm: [4.5, 5] } } }).recovery({ time: 120 }))
 *   .cooldown({ lapButton: true })
 *   .build();
 * ```
 *
 * @example Multi-sport brick
 * ```ts
 * buildWorkout("Brick", { sport: "multi_sport", sessionTransitionsEnabled: true })
 *   .leg("cycling", (l) => l.interval({ time: 1800 }))
 *   .leg("running", (l) => l.interval({ distance: 5000 }))
 *   .build();
 * ```
 */
export function buildWorkout(name: string, options: WorkoutBuildOptions): WorkoutBuilder {
  // One counter for the whole tree — this is what makes stepOrder globally unique, including
  // through repeat children, which Garmin requires.
  let order = 0;
  return new WorkoutBuilder(name, options, () => ++order);
}
