export interface Activity {
  activityId: number;
  activityName?: string;
  startTimeLocal?: string;
  distance?: number;
  duration?: number;
  activityType?: Record<string, unknown>;
  [key: string]: unknown;
}

export type ActivityDownloadFormat = "ORIGINAL" | "TCX" | "GPX" | "KML" | "CSV";

/**
 * Response shape of `GET /mobile-gateway/heartRate/forDate/{fordate}` (upstream's
 * `get_activities_fordate`) is undocumented beyond "a dict" — index signature only,
 * no fields invented.
 */
export interface ActivitiesForDateResponse {
  [key: string]: unknown;
}

/**
 * One entry of `GET /activity-service/activity/activityTypes`'s response. Fields observed
 * live against a real account (not invented): `typeId`, `typeKey`, `parentTypeId`,
 * `isHidden`, `restricted`, `trimmable`.
 */
export interface ActivityType {
  typeId: number;
  typeKey: string;
  parentTypeId: number;
  isHidden?: boolean;
  restricted?: boolean;
  trimmable?: boolean;
  [key: string]: unknown;
}

/**
 * Response of `GET /activity-service/activity/activityTypes`.
 *
 * The upstream method inventory's `returns` column says "dict" for `get_activity_types`, but
 * the live response is a JSON ARRAY of `ActivityType` (154 entries observed against a real
 * account, e.g. `{typeId:1, typeKey:"running", parentTypeId:17, ...}`) — not an object. This
 * type reflects the observed reality rather than the inventory's label; flagged for the
 * inventory to be corrected upstream of this port.
 */
export type ActivityTypesResponse = ActivityType[];

/** Result of `POST /upload-service/upload/{ext}` (`import_activity`). */
export interface ImportActivityResult {
  [key: string]: unknown;
}

/**
 * Response shapes for the per-activity detail sub-resources below are undocumented beyond the
 * inventory's blanket "dict" label — index signatures only, no fields invented. Where a field is
 * mentioned by name in the upstream inventory's notes (e.g. `exerciseSets`), it is included.
 */
export interface ActivitySplits {
  [key: string]: unknown;
}

export interface ActivityTypedSplits {
  [key: string]: unknown;
}

export interface ActivitySplitSummaries {
  [key: string]: unknown;
}

export interface ActivityWeather {
  [key: string]: unknown;
}

export interface ActivityHrInTimezones {
  [key: string]: unknown;
}

export interface ActivityPowerInTimezones {
  [key: string]: unknown;
}

export interface ActivityDetails {
  [key: string]: unknown;
}

/** `get_activity_exercise_sets`'s response and `set_activity_exercise_sets`'s payload share this shape. */
export interface ActivityExerciseSets {
  exerciseSets?: unknown[];
  [key: string]: unknown;
}

/** `GET /gear-service/gear/filterGear?activityId=...` (`get_activity_gear`). */
export interface ActivityGear {
  [key: string]: unknown;
}

/** One entry of `GET /activitylist-service/activities/{gearUUID}/gear` (`get_gear_activities`). */
export interface GearActivity {
  [key: string]: unknown;
}

/** `.json()` result of `PUT /gear-service/gear/link|unlink/{gearUUID}/activity/{activityId}`. */
export interface GearLinkResult {
  [key: string]: unknown;
}

/** `GET /fitnessstats-service/activity` (`get_progress_summary_between_dates`). */
export interface ProgressSummary {
  [key: string]: unknown;
}
