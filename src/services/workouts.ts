import { pathSegment } from "../util/validate.js";
import { GarminError } from "../errors.js";
import type { GarminClient } from "../client.js";
import * as devices from "./devices.js";
import { formatDate } from "../util/date.js";
import {
  WORKOUT_SPORT_TYPE_ID,
  type CalendarItem,
  type CalendarMonth,
  type WorkoutInput,
  type WorkoutRecord,
} from "../types/workouts.js";

export interface WorkoutsHost {
  readonly client: GarminClient;
}

// ---------------------------------------------------------------------------
// Basic CRUD
// ---------------------------------------------------------------------------

/**
 * `list`, "passes through unchecked" per the inventory — stays nullable, NOT
 * coalesced to `[]` (per the project rule: only methods whose inventory row
 * explicitly documents `[]`-coalescing do that; "passes through unchecked"
 * means exactly what it says).
 */
export async function getWorkouts(
  host: WorkoutsHost,
  start = 0,
  limit = 100,
): Promise<WorkoutRecord[] | null> {
  return host.client.connectapi<WorkoutRecord[]>("/workout-service/workouts", {
    params: { start, limit },
  });
}

/** `dict`, passes through unchecked per the inventory. */
export async function getWorkoutById(
  host: WorkoutsHost,
  workoutId: number | string,
): Promise<WorkoutRecord | null> {
  return host.client.connectapi<WorkoutRecord>(`/workout-service/workout/${pathSegment(workoutId)}`);
}

/**
 * UNCERTAIN (inventory): "no explicit null handling". Deletes the template
 * from the workout library — irreversible.
 */
export async function deleteWorkout(host: WorkoutsHost, workoutId: number | string): Promise<unknown> {
  return host.client.connectapi(`/workout-service/workout/${pathSegment(workoutId)}`, { method: "DELETE" });
}

/**
 * UNCERTAIN (inventory): "routed through `self.download(url)`", no explicit
 * null handling reviewed. Returns the workout's FIT-file bytes.
 */
export async function downloadWorkout(host: WorkoutsHost, workoutId: number | string): Promise<Buffer> {
  return host.client.download(`/workout-service/workout/FIT/${pathSegment(workoutId)}`);
}

/**
 * `workout_json` may be a caller-built object/array, or a JSON string (parsed here, matching
 * upstream's `json.loads` — an invalid string throws `GarminError`, the TS analogue of upstream's
 * `ValueError`). After parsing, the result must be an object or an array, else `GarminError`
 * (upstream: `ValueError`). UNCERTAIN (inventory): no explicit null handling on the response
 * beyond this input validation.
 */
/**
 * MULTI-SPORT WORKOUTS ARE SUPPORTED by this method, though no helper wraps them.
 *
 * Confirmed 2026-09-23 by building one in Garmin's own workout designer, capturing the POST, and
 * then round-tripping the same shape through this method: created, read back with both segments
 * and the transition flag intact, deleted. A multi-sport workout is a single workout whose
 * top-level `sportType` is `multi_sport` (`WORKOUT_SPORT_TYPE_ID.MULTI_SPORT`, id 10) and whose
 * `workoutSegments` each carry their OWN `sportType` — the array this library already models.
 *
 * ```ts
 * await garmin.uploadWorkout({
 *   workoutName: "Brick",
 *   sportType: { sportTypeId: WORKOUT_SPORT_TYPE_ID.MULTI_SPORT, sportTypeKey: "multi_sport", displayOrder: 5 },
 *   estimatedDurationInSecs: 3000,
 *   isSessionTransitionEnabled: true, // the designer's "Transitions" toggle
 *   workoutSegments: [
 *     { segmentOrder: 1, sportType: { sportTypeId: 1, sportTypeKey: "running", displayOrder: 1 }, workoutSteps: [ ... ] },
 *     { segmentOrder: 2, sportType: { sportTypeId: 2, sportTypeKey: "cycling", displayOrder: 2 }, workoutSteps: [ ... ] },
 *   ],
 * });
 * ```
 *
 * **`stepOrder` IS GLOBAL ACROSS SEGMENTS, not per-segment.** Numbering each segment's steps from 1
 * is the obvious mistake and Garmin rejects it with
 * `400 "The workout steps need to have unique step orders, or all be unset and rely on submission
 * structure order."` Either number every step uniquely across the whole workout, or omit
 * `stepOrder` entirely and let submission order decide.
 *
 * REPEAT BLOCKS work, and their shape is confirmed against a designer-built workout:
 * `{ type: "RepeatGroupDTO", stepType: repeat (id 6), numberOfIterations, smartRepeat, childStepId,
 * endCondition: iterations (id 7), workoutSteps: [ ...nested ExecutableStepDTO ] }` — exactly what
 * `RepeatWorkoutGroup` models. Round-tripped through `uploadWorkout`: a warmup, a 3-iteration
 * repeat containing an interval and a recovery, and a cooldown, all read back intact.
 *
 * **`stepOrder` numbering continues THROUGH a repeat's children.** In the designer's own payload:
 * warmup=1, interval=2, repeat=3, its two children=4 and 5, cooldown=6. Nested steps share the one
 * global sequence; they do not restart at 1 inside the block.
 *
 * **`pace.zone` targets are SPEEDS IN METRES PER SECOND, not paces** — and `targetValueOne` is the
 * FASTER bound, so it is the LARGER number. The designer's 8:30-9:30 min/mile became
 * `targetValueOne: 3.1556, targetValueTwo: 2.8234` (1609.344 m / 510 s and / 570 s). A caller
 * thinking in minutes-per-km will produce a wildly wrong target with no error.
 *
 * A REPEAT CAN BE TIME-BASED instead of count-based. Garmin's HIIT designer offers "Repeat Until
 * Time Is", which produces `endCondition: time`, the seconds in `endConditionValue`, and
 * **`numberOfIterations: null`** — which is why `RepeatWorkoutGroup.numberOfIterations` is
 * `number | null` here where upstream types it as a plain required number. Both forms
 * round-tripped through `uploadWorkout`.
 *
 * WEIGHT rides on a step as `weightValue` plus `weightUnit` (`{unitId, unitKey, factor}`), and
 * Garmin stores it in KILOGRAMS whatever the UI shows. Entering "20 lbs" in the designer stored
 * `weightValue: 19.998…` with `unitKey: "pound"`; sending `9.0718474` with `unitKey: "kilogram"`
 * stored `9.071`. Expect small round-trip drift either way — do not assert exact equality on a
 * weight you sent.
 *
 * Two naming traps around exercises, both observed live:
 *  - The DISPLAY name is not the stored key. "Barbell Overhead Press" in the picker stores as
 *    `category: "SHOULDER_PRESS", exerciseName: "OVERHEAD_BARBELL_PRESS"`.
 *  - Adding a weight can CHANGE the exercise. A "Push-up" with a manual weight stored as
 *    `category: "PUSH_UP", exerciseName: "WEIGHTED_PUSH_UP"` — Garmin swapped in the weighted
 *    variant by itself.
 *
 * STRENGTH steps carry an exercise pair: `category` plus `exerciseName`, both SCREAMING_SNAKE_CASE
 * (`category: "SQUAT"`, `exerciseName: "BARBELL_BACK_SQUAT"`), with `endCondition: reps` (id 10)
 * and `endConditionValue` as the rep count. The designer offers 548 exercises. Verified by
 * round-trip. The same category vocabulary appears in `setActivityExerciseSets`.
 *
 * `displayOrder` inside a `sportType`/`stepType`/`endCondition` ref is COSMETIC — Garmin accepts a
 * strength workout with `displayOrder: 4` (what its own client sends) or `5` (what this library's
 * `uploadStrengthWorkout` sends) identically. Do not treat a mismatch there as a bug.
 *
 * The designer also offers workout types this library has no helper for — Cardio, HIIT, Yoga,
 * Pilates, Mobility, Rucking, Custom and Multisport. All are reachable here by passing the matching
 * `sportType` explicitly; `WORKOUT_SPORT_TYPE_ID` already exports the ids, and they were confirmed
 * against a real designer-produced payload.
 */
export async function uploadWorkout(
  host: WorkoutsHost,
  workoutJson: Record<string, unknown> | unknown[] | string,
): Promise<WorkoutRecord | null> {
  const body = parseWorkoutJson(workoutJson, /* allowArray */ true);
  return host.client.connectapi<WorkoutRecord>("/workout-service/workout", {
    method: "POST",
    json: body,
  });
}

/**
 * Full-replace semantics: Garmin's PUT replaces the whole workout, so `workout_json` must be the
 * complete structure. `workoutId` is forced into the body to match the path id, overriding
 * whatever (if anything) the caller put there — matches upstream's `{**parsed, "workoutId":
 * workout_id}` merge. Unlike `uploadWorkout`, a string input must resolve to an object, not an
 * array (upstream: `ValueError` otherwise; here: `GarminError`). UNCERTAIN (inventory): no
 * explicit null handling on the response.
 */
export async function updateWorkout(
  host: WorkoutsHost,
  workoutId: number | string,
  workoutJson: Record<string, unknown> | string,
): Promise<WorkoutRecord | null> {
  const parsed = parseWorkoutJson(workoutJson, /* allowArray */ false);
  const body = { ...(parsed as Record<string, unknown>), workoutId };
  return host.client.connectapi<WorkoutRecord>(`/workout-service/workout/${pathSegment(workoutId)}`, {
    method: "PUT",
    json: body,
  });
}

function parseWorkoutJson(
  input: Record<string, unknown> | unknown[] | string,
  allowArray: boolean,
): Record<string, unknown> | unknown[] {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown;
    } catch (cause) {
      throw new GarminError("workout_json is not valid JSON", { cause });
    }
  }
  if (Array.isArray(value)) {
    if (!allowArray) {
      throw new GarminError("workout_json must resolve to an object, not an array, for updateWorkout");
    }
    // `Array.isArray` narrows `unknown` to `any[]` (a lib.d.ts quirk, not a
    // real loss of safety here — `value` came from `unknown`), so an
    // explicit cast back to `unknown[]` is needed to satisfy
    // `no-unsafe-return`.
    return value as unknown[];
  }
  if (value !== null && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  throw new GarminError("workout_json must be an object or array (or a JSON string of one)");
}

// ---------------------------------------------------------------------------
// Per-sport upload helpers
//
// The inventory's `body` column for these six rows says only "`workout.to_dict()` from a
// `<Sport>Workout` pydantic model" — it does not give the model's field-level shape, and this
// port carries zero runtime dependencies, so there is no pydantic model to port. The shape below
// was NOT invented to fill that gap: it was read directly from upstream's actual implementation,
// `garminconnect/workout.py` (cyberjunky/python-garminconnect, fetched from GitHub during this
// task), which is the primary source the inventory row itself summarizes. See task-6-report.md
// for the full account of this deviation from "transcribe from the inventory table alone".
//
// All six sports share IDENTICAL structure beyond `sportType`'s default value (workoutName,
// estimatedDurationInSecs, workoutSegments, author, description — upstream's `BaseWorkout`) — that
// commonality is real and is factored into one `buildSportWorkout` helper below, not six
// near-copies. The one thing that differs per sport (the default `sportType` id/key/displayOrder)
// is kept as six distinct constants rather than flattened into a lookup, because a caller can
// override `sportType` per call and each of the six default triples IS the fact this port must get
// exactly right.
//
// Upstream additionally raises `TypeError` if `workout` isn't an instance of the matching pydantic
// class, and `ImportError` if pydantic isn't installed. Neither is reproduced here: there is no
// pydantic dependency to be missing, and there is no runtime class to check `instanceof` against a
// plain object literal. Minimal shape validation (`workoutName`, `estimatedDurationInSecs`,
// `workoutSegments` all present) substitutes for the `TypeError` case.
// ---------------------------------------------------------------------------

function buildSportWorkout(
  input: WorkoutInput,
  defaultSportType: Record<string, unknown>,
): Record<string, unknown> {
  if (
    typeof input.workoutName !== "string" ||
    typeof input.estimatedDurationInSecs !== "number" ||
    !Array.isArray(input.workoutSegments)
  ) {
    throw new GarminError(
      "workout must have workoutName (string), estimatedDurationInSecs (number), and workoutSegments (array)",
    );
  }
  return {
    ...input,
    sportType: input.sportType ?? defaultSportType,
  };
}

const RUNNING_SPORT_TYPE = {
  sportTypeId: WORKOUT_SPORT_TYPE_ID.RUNNING,
  sportTypeKey: "running",
  displayOrder: 1,
};
const CYCLING_SPORT_TYPE = {
  sportTypeId: WORKOUT_SPORT_TYPE_ID.CYCLING,
  sportTypeKey: "cycling",
  displayOrder: 2,
};
const SWIMMING_SPORT_TYPE = {
  sportTypeId: WORKOUT_SPORT_TYPE_ID.SWIMMING,
  sportTypeKey: "swimming",
  displayOrder: 3,
};
const WALKING_SPORT_TYPE = {
  sportTypeId: WORKOUT_SPORT_TYPE_ID.WALKING,
  sportTypeKey: "walking",
  displayOrder: 17,
};
const HIKING_SPORT_TYPE = {
  sportTypeId: WORKOUT_SPORT_TYPE_ID.HIKING,
  sportTypeKey: "hiking",
  displayOrder: 18,
};
const STRENGTH_SPORT_TYPE = {
  sportTypeId: WORKOUT_SPORT_TYPE_ID.STRENGTH_TRAINING,
  sportTypeKey: "strength_training",
  displayOrder: 5,
};

/** Delegates to `uploadWorkout`, matching the inventory's "POST (delegates to upload_workout)". */
export async function uploadRunningWorkout(
  host: WorkoutsHost,
  workout: WorkoutInput,
): Promise<WorkoutRecord | null> {
  return uploadWorkout(host, buildSportWorkout(workout, RUNNING_SPORT_TYPE));
}

export async function uploadCyclingWorkout(
  host: WorkoutsHost,
  workout: WorkoutInput,
): Promise<WorkoutRecord | null> {
  return uploadWorkout(host, buildSportWorkout(workout, CYCLING_SPORT_TYPE));
}

export async function uploadSwimmingWorkout(
  host: WorkoutsHost,
  workout: WorkoutInput,
): Promise<WorkoutRecord | null> {
  return uploadWorkout(host, buildSportWorkout(workout, SWIMMING_SPORT_TYPE));
}

export async function uploadWalkingWorkout(
  host: WorkoutsHost,
  workout: WorkoutInput,
): Promise<WorkoutRecord | null> {
  return uploadWorkout(host, buildSportWorkout(workout, WALKING_SPORT_TYPE));
}

export async function uploadHikingWorkout(
  host: WorkoutsHost,
  workout: WorkoutInput,
): Promise<WorkoutRecord | null> {
  return uploadWorkout(host, buildSportWorkout(workout, HIKING_SPORT_TYPE));
}

export async function uploadStrengthWorkout(
  host: WorkoutsHost,
  workout: WorkoutInput,
): Promise<WorkoutRecord | null> {
  return uploadWorkout(host, buildSportWorkout(workout, STRENGTH_SPORT_TYPE));
}

// ---------------------------------------------------------------------------
// Device push
// ---------------------------------------------------------------------------

/**
 * Multi-step, matching upstream exactly: resolves a missing `deviceId` via the devices service's
 * `getDeviceLastUsed()`'s `userDeviceId` (upstream: `get_device_last_used()["userDeviceId"]` — a
 * plain dict index that would KeyError on a missing key; translated here as a `GarminError` throw
 * rather than letting `undefined.userDeviceId` crash), and a missing `workoutId` via
 * the first result of `getWorkouts(0, 1)` (throws `GarminError` matching
 * upstream's `ValueError("No workouts found to push.")` if the account has no
 * workouts). `messageName` always comes from `getWorkoutById(workoutId)`'s
 * `workoutName`. `messageUrl` is the literal relative string upstream sends
 * (no leading slash), NOT an absolute path.
 *
 * UNCERTAIN (inventory): no explicit null handling on the final POST.
 */
export async function pushWorkoutToDevice(
  host: WorkoutsHost,
  workoutId?: number | string,
  deviceId?: number | string,
): Promise<WorkoutRecord | null> {
  const resolvedDeviceId = deviceId ?? (await resolveLastUsedDeviceId(host));
  const resolvedWorkoutId = workoutId ?? (await resolveFirstWorkoutId(host));

  const workout = await getWorkoutById(host, resolvedWorkoutId);
  const messageName = workout?.workoutName;
  if (typeof messageName !== "string") {
    throw new GarminError(
      `Cannot push workout ${String(resolvedWorkoutId)}: getWorkoutById returned no workoutName`,
    );
  }

  return host.client.connectapi<WorkoutRecord>("/device-service/devicemessage/messages", {
    method: "POST",
    json: [
      {
        deviceId: resolvedDeviceId,
        messageUrl: `workout-service/workout/FIT/${resolvedWorkoutId}`,
        messageType: "workouts",
        groupName: null,
        messageName,
        priority: 1,
        fileType: "FIT",
        metaDataId: resolvedWorkoutId,
      },
    ],
  });
}

async function resolveLastUsedDeviceId(host: WorkoutsHost): Promise<number | string> {
  const device = await devices.getDeviceLastUsed(host);
  const id = device?.userDeviceId;
  if (id === undefined) {
    throw new GarminError("No last-used device found (userDeviceId missing) to push workout to");
  }
  return id;
}

async function resolveFirstWorkoutId(host: WorkoutsHost): Promise<number | string> {
  const list = await getWorkouts(host, 0, 1);
  const id = list?.[0]?.workoutId;
  if (id === undefined) {
    throw new GarminError("No workouts found to push.");
  }
  return id;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/**
 * `dict`, passes through unchecked. **Month is 0-indexed on the wire**: this
 * takes a normal 1-12 `month` and subtracts 1 before building the URL. Both
 * `year` (>=2000) and `month` (1-12) are validated as upstream does.
 */
export async function getScheduledWorkouts(
  host: WorkoutsHost,
  year: number | string,
  month: number | string,
): Promise<CalendarMonth | null> {
  const yearNum = Number(year);
  const monthNum = Number(month);
  if (!Number.isInteger(yearNum) || yearNum < 2000) {
    throw new GarminError(`Expected year >= 2000, got "${String(year)}"`);
  }
  if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
    throw new GarminError(`Expected month between 1 and 12, got "${String(month)}"`);
  }
  return host.client.connectapi<CalendarMonth>(
    `/calendar-service/year/${pathSegment(yearNum)}/month/${pathSegment(monthNum - 1)}`,
  );
}

/**
 * `dict`, passes through unchecked. Uses a DIFFERENT base
 * (`/workout-service/schedule`) than `getScheduledWorkouts`
 * (`/calendar-service`), despite both being about scheduled workouts —
 * transcribed verbatim from the inventory, not a typo.
 */
export async function getScheduledWorkoutById(
  host: WorkoutsHost,
  scheduledWorkoutId: number | string,
): Promise<WorkoutRecord | null> {
  return host.client.connectapi<WorkoutRecord>(`/workout-service/schedule/${pathSegment(scheduledWorkoutId)}`);
}

/**
 * Computed, no HTTP path of its own: calls `getScheduledWorkouts` for the
 * current month and the next (handling a December->January year rollover),
 * treats a falsy/`null` result from either as `{}`, merges `calendarItems`
 * from both, filters to `itemType === "workout"` with `date >= today`, sorts
 * by date, and returns the first match. Returns `{}` (never throws) if
 * nothing matches — matching the inventory's documented behaviour.
 */
export async function getNextScheduledWorkout(
  host: WorkoutsHost,
): Promise<CalendarItem | Record<string, never>> {
  const today = new Date();
  const todayStr = formatDate(today);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1; // 1-12
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  const [current, next] = await Promise.all([
    getScheduledWorkouts(host, year, month),
    getScheduledWorkouts(host, nextYear, nextMonth),
  ]);

  const items = [...(current?.calendarItems ?? []), ...(next?.calendarItems ?? [])].filter(
    (item): item is CalendarItem & { date: string } =>
      item.itemType === "workout" && typeof item.date === "string" && item.date >= todayStr,
  );
  items.sort((a, b) => a.date.localeCompare(b.date));
  return items[0] ?? {};
}

/**
 * UNCERTAIN (inventory): "no explicit null handling". `date_str` is routed
 * through `formatDate`, matching upstream's `_validate_date_format`.
 */
export async function scheduleWorkout(
  host: WorkoutsHost,
  workoutId: number | string,
  dateStr: string | Date,
): Promise<WorkoutRecord | null> {
  const date = formatDate(dateStr);
  return host.client.connectapi<WorkoutRecord>(`/workout-service/schedule/${pathSegment(workoutId)}`, {
    method: "POST",
    json: { date },
  });
}

/**
 * UNCERTAIN (inventory): "no explicit null handling". Removes the calendar
 * entry without deleting the underlying workout template — irreversible.
 */
export async function unscheduleWorkout(
  host: WorkoutsHost,
  scheduledWorkoutId: number | string,
): Promise<unknown> {
  return host.client.connectapi(`/workout-service/schedule/${pathSegment(scheduledWorkoutId)}`, {
    method: "DELETE",
  });
}
