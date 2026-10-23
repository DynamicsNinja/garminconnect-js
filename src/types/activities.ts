import type { ActivitySummaryDTO, SummarizedActivityDTO } from "../generated/personal-api.js";

/**
 * One row of an activity list (`getActivities`, `getActivitiesByDate`, `getLastActivity`).
 *
 * Fields beyond the five below come from Garmin's Personal API spec (`PersonalApi.SummarizedActivityDTO`,
 * 230 fields), which describes this same endpoint. All optional: Garmin leaves out what does not
 * apply to the activity, so a run has no swim cadence and no dive fields.
 */
export interface Activity extends SummarizedActivityDTO {
  activityId: number;
  activityName?: string;
  startTimeLocal?: string;
  distance?: number;
  duration?: number;
}

/**
 * One activity by id, from `getActivity`. NOT the list-row shape: the measurements live under
 * `summaryDTO` (distance in meters, duration in seconds), the type under `activityTypeDTO`.
 * Fields from Garmin's Personal API spec (`PersonalApi.ActivitySummaryDTO`).
 */
export interface ActivitySummary extends ActivitySummaryDTO {
  activityId: number;
}

/** A file format `downloadActivity` can produce. `ORIGINAL` is the file the device uploaded. */
export type ActivityDownloadFormat = "ORIGINAL" | "TCX" | "GPX" | "KML" | "CSV";

/**
 * Response shape of `GET /mobile-gateway/heartRate/forDate/{fordate}` is undocumented beyond
 * "an object" — index signature only, no fields invented.
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
 * The live response is a JSON ARRAY of `ActivityType` (154 entries observed against a real
 * account, e.g. `{typeId:1, typeKey:"running", parentTypeId:17, ...}`) — not an object.
 */
export type ActivityTypesResponse = ActivityType[];

/** Result of `POST /upload-service/upload/{ext}`. */
export interface ImportActivityResult {
  [key: string]: unknown;
}

/**
 * Result of `POST /upload-service/upload` — the plain, non-import upload (distinct endpoint and
 * headers from `importActivity`, see that function's doc comment). The raw response is passed
 * through; it may be null. Undocumented shape.
 */
export interface UploadActivityResult {
  [key: string]: unknown;
}

/**
 * `GET /personalrecord-service/personalrecord/prs/{displayName}`. Passes
 * through unchecked. **The response is an ARRAY, not an object (verified live).** For
 * `activityType === "running"`, `typeId` maps 1=1km, 2=1mile, 3=5km, 4=10km, 5=half marathon,
 * 6=marathon, 7=longest run (distance in meters; duration would need a separate `getActivity`
 * call) — not modeled as fields here since the test account has zero personal records, but
 * recorded for a caller reading the raw response.
 */
/** One personal-record row. Shape unobserved — the test account has no records. */
export type PersonalRecord = Record<string, unknown>;

/**
 * What `getPersonalRecord` actually returns: an ARRAY, despite the singular method name
 * (verified live). Named plural so the call site cannot be misread as returning a single record —
 * the same singular-row/plural-result split applied to `Gear` and `GearDefaults`.
 */
export type PersonalRecords = PersonalRecord[];

/**
 * Response shapes for the per-activity detail sub-resources below are undocumented — index
 * signatures only, no fields invented. Where a field is known by name (e.g. `exerciseSets`), it
 * is included.
 */
export interface ActivitySplits {
  [key: string]: unknown;
}

/** `getActivityTypedSplits`' response. */
export interface ActivityTypedSplits {
  [key: string]: unknown;
}

/** `getActivitySplitSummaries`' response. */
export interface ActivitySplitSummaries {
  [key: string]: unknown;
}

/** `getActivityWeather`'s response. */
export interface ActivityWeather {
  [key: string]: unknown;
}

/** `getActivityHrInTimezones`' response: time in each heart-rate zone. */
export interface ActivityHrInTimezones {
  [key: string]: unknown;
}

/** `getActivityPowerInTimezones`' response: time in each power zone. */
export interface ActivityPowerInTimezones {
  [key: string]: unknown;
}

/** `getActivityDetails`' response: the activity's time series and track. */
export interface ActivityDetails {
  [key: string]: unknown;
}

/** `getActivityExerciseSets`'s response and `setActivityExerciseSets`'s payload share this shape. */
export interface ActivityExerciseSets {
  exerciseSets?: unknown[];
  [key: string]: unknown;
}

/**
 * One entry of `GET /gear-service/gear/filterGear?activityId=...`. The
 * endpoint returns a JSON ARRAY of these, not a single object (verified live, as for the sibling
 * `userProfilePk`-filtered call `getGear` uses). `getActivityGear` returns `ActivityGear[] | null`
 * accordingly.
 */
export interface ActivityGear {
  [key: string]: unknown;
}

/** One entry of `GET /activitylist-service/activities/{gearUUID}/gear`. */
export interface GearActivity {
  [key: string]: unknown;
}

/** `.json()` result of `PUT /gear-service/gear/link|unlink/{gearUUID}/activity/{activityId}`. */
export interface GearLinkResult {
  [key: string]: unknown;
}

/** `GET /fitnessstats-service/activity`. */
export interface ProgressSummary {
  [key: string]: unknown;
}

/**
 * `GET /activity-service/activity/eventTypes` entry: the purpose an activity is filed under
 * ("race", "training", …). Read live on 2026-10-06; nine entries.
 */
export interface ActivityEventType {
  typeId: number;
  typeKey: ActivityEventTypeKey;
  sortOrder: number;
}

/** The nine `typeKey`s `GET /activity-service/activity/eventTypes` returned on 2026-10-06. */
export type ActivityEventTypeKey =
  | "race"
  | "recreation"
  | "specialEvent"
  | "training"
  | "transportation"
  | "touring"
  | "geocaching"
  | "fitness"
  | "uncategorized";

/**
 * Garmin Connect's "How did you feel?" rating, stored as `summaryDTO.directWorkoutFeel`:
 * 0 very weak, 25 weak, 50 normal, 75 strong, 100 very strong.
 */
export type ActivityFeel = 0 | 25 | 50 | 75 | 100;
