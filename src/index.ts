/**
 * An unofficial TypeScript client for the Garmin Connect API.
 *
 * Exports `GarminClient` (sign-in, tokens and the HTTP transport), `Garmin` (one method per
 * endpoint), the token stores, the `GarminError` hierarchy, the request and response types, the
 * workout id tables, and the workout tools: `buildWorkout`, `workoutFromSpec` and
 * `WORKOUT_SPEC_JSON_SCHEMA`. The exercise catalogue and the method manifest are separate entry
 * points (`./exercises` and `./manifest`).
 *
 * ```ts
 * import { FileTokenStore, Garmin, GarminClient } from "garminconnect-js";
 *
 * const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
 * const result = await client.login(email, password);
 * if (result.state === "mfa_required") await client.resumeLogin(result.mfaState, code);
 *
 * const garmin = new Garmin(client);
 * console.log(await garmin.getUserSummary("2026-09-22"));
 * ```
 *
 * @module
 */
export * from "./errors.js";
export { GarminClient, type ApiOptions, type GarminClientOptions } from "./client.js";
export { Garmin, type SocialProfile, type UserSettings } from "./garmin.js";
export { CONNECT_PLUS_METHODS, type ConnectPlusMethod } from "./connect-plus.js";
export {
  FileTokenStore,
  MemoryTokenStore,
  type TokenStore,
} from "./auth/token-store.js";
export type {
  OAuth1Token,
  OAuth2Token,
  Tokens,
} from "./auth/tokens.js";
export type { LoginResult, MfaState, MobileMfaState } from "./auth/sso.js";
export type { WidgetMfaState } from "./auth/widget.js";
export type { SerializedCookie } from "./http/cookie-jar.js";
export type * from "./types/wellness.js";
export type * from "./types/activities.js";
export type * from "./types/weight.js";
export type * from "./types/bodyComposition.js";
export type * from "./types/devices.js";
export type * from "./types/gear.js";
export type * from "./types/courses.js";
export type * from "./types/calendar.js";
export type * from "./types/metrics.js";
export type * from "./types/workouts.js";
/**
 * `types/workouts.js` also declares four RUNTIME lookup tables. `export type *` above re-exports
 * only its types, so these must be named explicitly here — without this line tsup's d.ts rollup
 * still listed them (without a `type` modifier) while neither JS bundle exported them, so
 * `require("garminconnect-js").WORKOUT_SPORT_TYPE_ID` was `undefined` and the ESM import threw
 * `SyntaxError: does not provide an export named ...`. They are genuinely useful to a caller
 * assembling a `WorkoutInput` by hand, so the fix is to export the values, not to hide them.
 */
export {
  WORKOUT_SPORT_TYPE_ID,
  WORKOUT_STEP_TYPE_ID,
  WORKOUT_CONDITION_TYPE_ID,
  WORKOUT_TARGET_TYPE_ID,
  // Swim/intensity enums, read live from `GET /workout-service/workout/types`.
  WORKOUT_STROKE_TYPE_ID,
  WORKOUT_DRILL_TYPE_ID,
  WORKOUT_EQUIPMENT_TYPE_ID,
  WORKOUT_SWIM_INSTRUCTION_TYPE_ID,
  WORKOUT_INTENSITY_TYPE_ID,
  WORKOUT_EXERCISE_CATEGORIES,
} from "./types/workouts.js";
export type * from "./types/womensHealth.js";
export type * from "./types/badges.js";
export type * from "./types/userProfile.js";
export type * from "./types/goals.js";
export type * from "./types/golf.js";
export type * from "./types/nutrition.js";
export type * from "./types/trainingPlans.js";
export type * from "./types/misc.js";

/**
 * Fluent workout builder — a convenience layer over `uploadWorkout`, which
 * still accepts raw JSON unchanged. See `src/workout-builder.ts`.
 */
export { buildWorkout, WorkoutBuilder, WorkoutStepList, WORKOUT_SPORTS } from "./workout-builder.js";
export type {
  WorkoutSport,
  WorkoutBuildOptions,
  StepOptions,
  StepEnd,
  StepTarget,
  StrokeKey,
  DrillKey,
  EquipmentKey,
  WorkoutExercise,
} from "./workout-builder.js";
export type { WeightScaleFields } from "./util/fit.js";

/**
 * JSON twin of `buildWorkout`: a workout as data, replayed through the builder. Pass `EXERCISES`
 * from `garminconnect-js/exercises` as the catalogue. See `src/workout-spec.ts`.
 */
export { workoutFromSpec } from "./workout-spec.js";
export type {
  WorkoutSpec,
  WorkoutSpecStep,
  WorkoutSpecLeg,
  SimpleStepType,
  ExerciseCatalogue,
} from "./workout-spec.js";
export { WORKOUT_SPEC_JSON_SCHEMA, type JsonSchemaDocument } from "./workout-spec-schema.js";
