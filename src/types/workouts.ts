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
  // Not part of upstream's `SportType` class (a gap in upstream itself) but
  // used as literal values by `WalkingWorkout`/`HikingWorkout`'s defaults.
  WALKING: 17,
  HIKING: 18,
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
  numberOfIterations: number;
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
