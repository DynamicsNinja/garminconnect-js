/**
 * One entry of `GET /gear-service/gear/filterGear?userProfilePk=...` — the endpoint
 * returns a JSON ARRAY of these (verified live: `array[3]` once gear existed on the test
 * account), not a single object. `getGear`
 * in `src/services/gear.ts` returns `Gear[] | null` accordingly. Same base URL as `getActivityGear`
 * in `src/types/activities.ts` (filtered by `activityId` there instead) — both pass the response
 * through unchecked, so this stays an honest index signature rather than a guessed shape.
 */
export interface Gear {
  [key: string]: unknown;
}

/**
 * `GET /gear-service/gear/stats/{gearUUID}`. `getGearStats` returns `{}` on a 404
 * instead of raising — see `src/services/gear.ts`. Unlike `Gear`/`GearDefaults`,
 * this one IS a single object per call (one gear's stats).
 */
export interface GearStats {
  [key: string]: unknown;
}

/**
 * One entry of `GET /gear-service/gear/user/{userProfileNumber}/activityTypes`
 * — the endpoint returns a JSON ARRAY of `{uuid, activityTypePk,
 * defaultGear}`-shaped entries (verified live), not a single object. `getGearDefaults` in
 * `src/services/gear.ts` returns
 * `GearDefaults[] | null` accordingly.
 */
export interface GearDefaults {
  [key: string]: unknown;
}

/**
 * `usageType` for `createGear`, read live from `/gear-service/gear/v2/usagetypes`. `createGear`
 * upper-cases it before sending, so lower case works too. Note `"TIME"` is NOT valid — Garmin
 * rejects it with a 400; the duration option is `DURATION`.
 */
export type GearUsageType =
  | "NONE"
  | "DISTANCE"
  | "DURATION"
  | "DATE"
  | Lowercase<"NONE" | "DISTANCE" | "DURATION" | "DATE">;
