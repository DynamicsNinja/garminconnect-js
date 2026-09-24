/**
 * Types for the `workouts` service (workout templates, per-sport upload
 * helpers, scheduling, and device push).
 *
 * The upstream inventory (`docs/upstream-method-inventory.md`, `workouts`
 * section) documents the six per-sport upload helpers only as "`dict` built
 * from `workout.to_dict()` of a pydantic `RunningWorkout`/`CyclingWorkout`/...
 * model" — it does not give the model's field-level shape. That shape was
 * NOT invented for this port: it was read directly from upstream's own
 * source, `garminconnect/workout.py` in cyberjunky/python-garminconnect
 * (fetched live from GitHub during this task, not from training-data
 * memory), which is the actual implementation the inventory row summarizes.
 * See workouts.ts and task-6-report.md for the full account of this
 * deviation from "transcribe from the inventory table alone".
 *
 * This port has zero runtime dependencies, so there is no pydantic model —
 * these are plain structural interfaces (`extra="allow"` on the upstream
 * models is reflected here as an index signature) and a runtime `TypeError`
 * equivalent (upstream raises if `workout` isn't an instance of the right
 * pydantic class) is NOT reproduced; the six wrappers instead do minimal
 * required-field validation on a plain object. See the workouts.ts module
 * doc comment for the full reasoning.
 */

/** `SportType` IDs — from `/workout-service/workout/types`, transcribed from upstream `workout.py`. */
export const WORKOUT_SPORT_TYPE_ID = {
  RUNNING: 1,
  CYCLING: 2,
  OTHER: 3,
  SWIMMING: 4,
  STRENGTH_TRAINING: 5,
  CARDIO_TRAINING: 6,
  YOGA: 7,
  PILATES: 8,
  HIIT: 9,
  MULTI_SPORT: 10,
  MOBILITY: 11,
  /** Live-only: present in Garmin's enum, absent from upstream entirely. */
  RUCKING: 13,
  /**
   * There is deliberately no WALKING or HIKING entry. Garmin's own workout enum
   * (`GET /workout-service/workout/types` -> `workoutSportTypes`) lists only
   * 1,2,3,4,5,6,7,8,9,10,11,13 — no walking or hiking workout sport type exists.
   *
   * Upstream python-garminconnect's `WalkingWorkout`/`HikingWorkout` send 17 and 18, which look
   * like Garmin ACTIVITY-type ids mistaken for workout sport types. Garmin ACCEPTS those and
   * stores `{sportTypeId: 0, sportTypeKey: null}` — a workout with no sport. This port shipped
   * `uploadWalkingWorkout`/`uploadHikingWorkout` for a while on parity grounds and removed them
   * on 2026-09-24: a method whose only behaviour is to create a broken record is worse than no
   * method, and the parity argument does not survive knowing more than upstream does.
   *
   * For a walk or hike template, use `uploadWorkout` with `OTHER` (3) or `CARDIO_TRAINING` (6).
   */
} as const;

/**
 * Swim stroke types — `GET /workout-service/workout/types` -> `workoutStrokeTypes`, read live
 * 2026-09-23. Not modelled upstream. Used as a step's `strokeType`.
 */
export const WORKOUT_STROKE_TYPE_ID = {
  ANY_STROKE: 1,
  BACKSTROKE: 2,
  BREASTSTROKE: 3,
  DRILL: 4,
  FLY: 5,
  FREE: 6,
  INDIVIDUAL_MEDLEY: 7,
  MIXED: 8,
  INDIVIDUAL_MEDLEY_BY_ROUND: 9,
  REVERSE_INDIVIDUAL_MEDLEY_BY_ROUND: 10,
} as const;

/** Swim drill types — `workoutDrillTypes`. Used as a step's `drillType`. */
export const WORKOUT_DRILL_TYPE_ID = { KICK: 1, PULL: 2, DRILL: 3 } as const;

/** Swim equipment — `workoutEquipmentTypes`. Used as a step's `equipmentType`. */
export const WORKOUT_EQUIPMENT_TYPE_ID = {
  FINS: 1,
  KICKBOARD: 2,
  PADDLES: 3,
  PULL_BUOY: 4,
  SNORKEL: 5,
} as const;

/** Swim instruction intensities — `workoutSwimInstructionTypes`. */
export const WORKOUT_SWIM_INSTRUCTION_TYPE_ID = {
  RECOVERY: 1,
  VERY_EASY: 2,
  EASY: 3,
  MODERATE: 4,
  HARD: 5,
  VERY_HARD: 6,
  ALL_OUT: 7,
  FAST: 8,
  ASCEND: 9,
  DESCEND: 10,
} as const;

/**
 * Every exercise category Garmin's workout service accepts, verified exhaustively against a live
 * account on 2026-09-23 by submitting each candidate on its own and keeping only those that were
 * accepted.
 *
 * The set is the FIT SDK's `exercise_category` enum (the first 34 entries here, in enum order) plus
 * 16 Garmin Connect additions — 50 in total. The Connect ones were found by reading the web
 * exercise picker's `data-category-key` attributes and then confirming each against the API. 49
 * other plausible names were tested and ALL rejected: `COOL_DOWN` (though `WARM_UP` is valid),
 * `BURPEE`, `KETTLEBELL`, `MOBILITY`, `YOGA`, `PILATES`, muscle groups like `CHEST` and `LEGS`, and
 * lift names like `CLEAN` and `SNATCH` (those belong in the exercise `name`, under `OLYMPIC_LIFT`).
 *
 * `BIKE`, `STRETCH` and `UNKNOWN` are accepted by the API but are NOT offered in the web picker.
 *
 * This matters more than a normal enum because **an invalid category fails the WHOLE upload** with
 * `400 "Invalid category"`, not just the offending step, and no endpoint lists the valid values.
 */
export const WORKOUT_EXERCISE_CATEGORIES = [
  // --- FIT SDK `exercise_category`, in enum order ---
  "BENCH_PRESS",
  "CALF_RAISE",
  "CARDIO",
  "CARRY",
  "CHOP",
  "CORE",
  "CRUNCH",
  "CURL",
  "DEADLIFT",
  "FLYE",
  "HIP_RAISE",
  "HIP_STABILITY",
  "HIP_SWING",
  "HYPEREXTENSION",
  "LATERAL_RAISE",
  "LEG_CURL",
  "LEG_RAISE",
  "LUNGE",
  "OLYMPIC_LIFT",
  "PLANK",
  "PLYO",
  "PULL_UP",
  "PUSH_UP",
  "ROW",
  "SHOULDER_PRESS",
  "SHOULDER_STABILITY",
  "SHRUG",
  "SIT_UP",
  "SQUAT",
  "TOTAL_BODY",
  "TRICEPS_EXTENSION",
  "WARM_UP",
  "RUN",
  "UNKNOWN",
  // --- Garmin Connect additions, beyond the FIT enum ---
  // The first three are accepted by the API but are NOT offered in the web exercise picker.
  "BIKE",
  "STRETCH",
  "BANDED_EXERCISES",
  "BATTLE_ROPE",
  "SLED",
  "SUSPENSION",
  // Equipment- and modality-specific categories, read from the web picker's `data-category-key`
  // and then each confirmed against the API.
  "BIKE_OUTDOOR",
  "INDOOR_BIKE",
  "RUN_INDOOR",
  "ELLIPTICAL",
  "STAIR_STEPPER",
  "FLOOR_CLIMB",
  "LADDER",
  "SANDBAG",
  "SLEDGE_HAMMER",
  "TIRE",
  "INDOOR_ROW",
  // Yoga poses and pilates/mobility moves. Neither appears in the strength exercise picker — they
  // came from Garmin's `exercise_types` translations bundle and were then confirmed against the
  // API, which accepts both and stores their names intact.
  "POSE",
  "MOVE",
] as const;

/**
 * One of the 53 categories Garmin accepts. See `WORKOUT_EXERCISE_CATEGORIES`.
 *
 * The exercise NAMES valid within each category ship separately, in
 * `garminconnect-js/exercises` — see that module for why the two halves are validated so
 * differently.
 */
export type ExerciseCategory = (typeof WORKOUT_EXERCISE_CATEGORIES)[number];

/** Step intensity — `workoutIntensityTypes`. */
export const WORKOUT_INTENSITY_TYPE_ID = {
  ACTIVE: 1,
  REST: 2,
  WARMUP: 3,
  COOLDOWN: 4,
} as const;

/** `StepType` IDs — from `/workout-service/workout/types`. */
export const WORKOUT_STEP_TYPE_ID = {
  WARMUP: 1,
  COOLDOWN: 2,
  INTERVAL: 3,
  RECOVERY: 4,
  REST: 5,
  REPEAT: 6,
  OTHER: 7,
  MAIN: 8,
} as const;

/** End-condition `ConditionType` IDs. */
export const WORKOUT_CONDITION_TYPE_ID = {
  LAP_BUTTON: 1,
  TIME: 2,
  DISTANCE: 3,
  CALORIES: 4,
  POWER: 5,
  HEART_RATE: 6,
  ITERATIONS: 7,
  FIXED_REST: 8,
  FIXED_REPETITION: 9,
  REPS: 10,
  // 11-24 exist in Garmin's live enum but not upstream. Read from
  // `GET /workout-service/workout/types` -> `workoutConditionTypes` on 2026-09-23.
  TRAINING_PEAKS_TSS: 11,
  REPETITION_TIME: 12,
  TIME_AT_VALID_CDA: 13,
  POWER_LAST_LAP: 14,
  MAX_POWER_LAST_LAP: 15,
  REPETITION_SWIM_CSS_OFFSET: 16,
  VELOCITY_LOSS: 17,
  CUSTOM_VELOCITY: 18,
  VBT_VELOCITY_ZONE: 19,
  VELOCITY_MIN: 20,
  PEAK_VELOCITY_MIN: 21,
  PEAK_VELOCITY_LOSS: 22,
  CUSTOM_PEAK_VELOCITY: 23,
  POWER_LOSS: 24,
} as const;

/** `TargetType` IDs. */
export const WORKOUT_TARGET_TYPE_ID = {
  NO_TARGET: 1,
  POWER_ZONE: 2,
  CADENCE: 3,
  HEART_RATE_ZONE: 4,
  SPEED_ZONE: 5,
  PACE_ZONE: 6,
  GRADE: 7,
  HEART_RATE_LAP: 8,
  POWER_LAP: 9,
  RESISTANCE: 15,
  // 10-27 (minus those above) exist in Garmin's live enum but not upstream. Read from
  // `GET /workout-service/workout/types` -> `workoutTargetTypes` on 2026-09-23.
  POWER_3S: 10,
  POWER_10S: 11,
  POWER_30S: 12,
  SPEED_LAP: 13,
  SWIM_STROKE: 14,
  POWER_CURVE: 16,
  SWIM_CSS_OFFSET: 17,
  SWIM_INSTRUCTION: 18,
  INSTRUCTION: 19,
  VELOCITY_LOSS: 20,
  CUSTOM_VELOCITY: 21,
  VBT_VELOCITY_ZONE: 22,
  POWER_LOSS: 23,
  VELOCITY_MIN: 24,
  PEAK_VELOCITY_MIN: 25,
  PEAK_VELOCITY_LOSS: 26,
  CUSTOM_PEAK_VELOCITY: 27,
} as const;

/** A generic `{id, key, displayOrder}`-shaped reference object used throughout workout JSON. */
export interface WorkoutTypeRef {
  [key: string]: unknown;
}

/** One executable workout step (warmup, interval, recovery, cooldown, rest, ...). */
export interface ExecutableWorkoutStep {
  type?: string; // default "ExecutableStepDTO" upstream
  stepOrder: number;
  stepType?: WorkoutTypeRef | null;
  endCondition?: WorkoutTypeRef | null;
  endConditionValue?: number | null;
  targetType?: WorkoutTypeRef | null;
  strokeType?: WorkoutTypeRef | null;
  equipmentType?: WorkoutTypeRef | null;
  childStepId?: number | null;
  /** Upstream's pydantic models declare `extra="allow"` on this type. */
  [key: string]: unknown;
}

/** A repeat block wrapping a set of steps (e.g. "3x" a warmup+interval pair). */
export interface RepeatWorkoutGroup {
  type?: string; // default "RepeatGroupDTO" upstream
  stepOrder: number;
  stepType?: WorkoutTypeRef | null;
  /**
   * The iteration count for a COUNT-based repeat. **Nullable**, because a repeat can instead be
   * TIME-based: Garmin's HIIT designer offers "Repeat Until Time Is", which stores
   * `endCondition: time`, the seconds in `endConditionValue`, and `numberOfIterations: null`.
   * Confirmed live 2026-09-23. Upstream types this as a plain required number, which cannot
   * express the time-based form.
   */
  numberOfIterations: number | null;
  workoutSteps: (ExecutableWorkoutStep | RepeatWorkoutGroup)[];
  endCondition?: WorkoutTypeRef | null;
  endConditionValue?: number | null;
  childStepId?: number | null;
  smartRepeat?: boolean;
  [key: string]: unknown;
}

/** One segment of a workout (upstream supports multiple, e.g. for multi-sport workouts). */
export interface WorkoutSegment {
  segmentOrder: number;
  sportType: WorkoutTypeRef;
  workoutSteps: (ExecutableWorkoutStep | RepeatWorkoutGroup)[];
  [key: string]: unknown;
}

/**
 * The shape accepted by the six per-sport upload helpers (`uploadRunningWorkout` etc.), mirroring
 * upstream's `BaseWorkout` pydantic model. `sportType` is optional here — each helper fills in the
 * correct default (matching that sport's upstream subclass default) when omitted, but an explicit
 * value is passed through unchanged if the caller supplies one.
 */
export interface WorkoutInput {
  workoutName: string;
  sportType?: WorkoutTypeRef;
  estimatedDurationInSecs: number;
  workoutSegments: WorkoutSegment[];
  author?: WorkoutTypeRef;
  description?: string;
  [key: string]: unknown;
}

/** A stored Garmin workout template. Untyped beyond the fields observed/documented; passes through unchecked. */
export interface WorkoutRecord {
  workoutId?: number;
  workoutName?: string;
  [key: string]: unknown;
}

/** One calendar item as returned inside `/calendar-service/year/{y}/month/{m}`'s `calendarItems`. */
export interface CalendarItem {
  itemType?: string;
  date?: string;
  [key: string]: unknown;
}

/** Response of `/calendar-service/year/{year}/month/{month}`. */
export interface CalendarMonth {
  calendarItems?: CalendarItem[];
  [key: string]: unknown;
}
