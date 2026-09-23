export * from "./errors.js";
export { GarminClient, type ApiOptions, type GarminClientOptions } from "./client.js";
export { Garmin, type SocialProfile, type UserSettings } from "./garmin.js";
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
export type { LoginResult, MfaState } from "./auth/sso.js";
export type { SerializedCookie } from "./http/cookie-jar.js";
export type * from "./types/wellness.js";
export type * from "./types/activities.js";
export type * from "./types/weight.js";
export type * from "./types/bodyComposition.js";
export type * from "./types/devices.js";
export type * from "./types/gear.js";
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
  // Swim/intensity enums, read live from `GET /workout-service/workout/types` — not in upstream.
  WORKOUT_STROKE_TYPE_ID,
  WORKOUT_DRILL_TYPE_ID,
  WORKOUT_EQUIPMENT_TYPE_ID,
  WORKOUT_SWIM_INSTRUCTION_TYPE_ID,
  WORKOUT_INTENSITY_TYPE_ID,
} from "./types/workouts.js";
export type * from "./types/womensHealth.js";
export type * from "./types/badges.js";
export type * from "./types/userProfile.js";
export type * from "./types/goals.js";
export type * from "./types/golf.js";
export type * from "./types/nutrition.js";
export type * from "./types/trainingPlans.js";
export type * from "./types/misc.js";
export type { WeightScaleFields } from "./util/fit.js";
