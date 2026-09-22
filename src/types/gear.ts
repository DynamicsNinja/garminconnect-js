/**
 * `GET /gear-service/gear/filterGear?userProfilePk=...` (`get_gear`). Same base URL as
 * `getActivityGear` in `src/types/activities.ts` (filtered by `activityId` there instead) — both
 * pass the response through unchecked ("dict" per the inventory), so this stays an honest index
 * signature rather than a guessed shape.
 */
export interface Gear {
  [key: string]: unknown;
}

/**
 * `GET /gear-service/gear/stats/{gearUUID}` (`get_gear_stats`). Upstream returns `{}` on a 404
 * instead of raising — see `getGearStats` in `src/services/gear.ts`.
 */
export interface GearStats {
  [key: string]: unknown;
}

/** `GET /gear-service/gear/user/{userProfileNumber}/activityTypes` (`get_gear_defaults`). */
export interface GearDefaults {
  [key: string]: unknown;
}
