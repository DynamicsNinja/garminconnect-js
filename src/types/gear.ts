/**
 * One entry of `GET /gear-service/gear/filterGear?userProfilePk=...` (`get_gear`) — the endpoint
 * returns a JSON ARRAY of these (live-verified in Task 7: `array[3]` once gear existed on the test
 * account), not a single object, despite the inventory listing its return type as "dict". `getGear`
 * in `src/services/gear.ts` returns `Gear[] | null` accordingly. Same base URL as `getActivityGear`
 * in `src/types/activities.ts` (filtered by `activityId` there instead) — both pass the response
 * through unchecked, so this stays an honest index signature rather than a guessed shape.
 */
export interface Gear {
  [key: string]: unknown;
}

/**
 * `GET /gear-service/gear/stats/{gearUUID}` (`get_gear_stats`). Upstream returns `{}` on a 404
 * instead of raising — see `getGearStats` in `src/services/gear.ts`. Unlike `Gear`/`GearDefaults`,
 * this one IS a single object per call (one gear's stats), matching upstream's own "dict" label.
 */
export interface GearStats {
  [key: string]: unknown;
}

/**
 * One entry of `GET /gear-service/gear/user/{userProfileNumber}/activityTypes`
 * (`get_gear_defaults`) — the endpoint returns a JSON ARRAY of `{uuid, activityTypePk,
 * defaultGear}`-shaped entries (live-verified in Task 7), not a single object, despite the
 * inventory listing its return type as "dict". `getGearDefaults` in `src/services/gear.ts` returns
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
