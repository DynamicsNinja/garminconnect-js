import type { ActivitySummaryDTO, ActivityWorkoutDTO, SummarizedActivityDTO } from "../generated/personal-api.js";

/**
 * Filters for `searchActivities`, from Garmin's Personal API spec and checked read-only on a real
 * account (2026-10-23). Every filter is optional and they combine with AND.
 */
export interface ActivitySearchFilters {
  /** Zero-based offset of the first activity. Default 0. */
  start?: number;
  /** Activities per page. Default 20. */
  limit?: number;
  /** Text to find in activity names and descriptions. */
  search?: string;
  /**
   * A PARENT activity type key, e.g. `"running"` or `"cycling"`; it includes its subtypes
   * (`"running"` also returns treadmill runs). A subtype key here is a 400; use `activitySubType`.
   */
  activityType?: string;
  /** A subtype key, e.g. `"treadmill_running"` or `"trail_running"`. Works alone or with its parent. */
  activitySubType?: string;
  /** Subtype keys to leave out, e.g. `["treadmill_running", "indoor_cycling"]`. */
  excludedActivitySubTypes?: string[];
  /** The event type the activity is filed under, e.g. `"race"`. */
  eventType?: ActivityEventTypeKey;
  /** Earliest local start date, inclusive (YYYY-MM-DD). */
  startDate?: string | Date;
  /** Latest local start date, inclusive (YYYY-MM-DD). */
  endDate?: string | Date;
  /** Minimum distance in meters, inclusive. */
  minDistance?: number;
  /** Maximum distance in meters, inclusive. */
  maxDistance?: number;
  /** Minimum timer duration in seconds, inclusive. */
  minDuration?: number;
  /** Maximum timer duration in seconds, inclusive. */
  maxDuration?: number;
  /** Minimum elapsed duration in seconds (paused time included), inclusive. */
  minElapsedDuration?: number;
  /** Maximum elapsed duration in seconds (paused time included), inclusive. */
  maxElapsedDuration?: number;
  /** Minimum total elevation gain in meters, inclusive. */
  minElevation?: number;
  /** Maximum total elevation gain in meters, inclusive. */
  maxElevation?: number;
  /** Minimum average power in watts, inclusive. */
  minAvgPower?: number;
  /** `true`: favorites only; `false`: non-favorites only; omit for both. */
  favorite?: boolean;
  /** Leave out the legs of multisport activities. Garmin's default is `true`. */
  excludeChildren?: boolean;
  /**
   * The field to sort by. `"startLocal"` (Garmin's default, the local start time) and
   * `"distance"` were checked; the spec also names `"name"` and `"duration"`. An unknown field
   * returns NO activities, not an error.
   */
  sortBy?: string;
  /** `"asc"` or `"desc"` (the default). */
  sortOrder?: "asc" | "desc";
  /**
   * Fields that must be present on every result, e.g. `["maxPower", "avgPower"]`. Garmin's own
   * field names, which are not always the response's: `"averageHR"` matches nothing even though
   * every activity has it. An unknown name returns NO activities, not an error.
   */
  requiredFields?: string[];
  /**
   * Activities that START inside this box, in decimal degrees. Garmin refuses a box wider than
   * 50 km ("bounding box must not exceed 50km").
   */
  boundingBox?: { north: number; south: number; east: number; west: number };
  /** Dives: minimum of the dive's maximum depth, in centimeters, inclusive. */
  minMaxDepth?: number;
  /** Dives: maximum of the dive's maximum depth, in centimeters, inclusive. */
  maxMaxDepth?: number;
  /** Dives: `true` decompression dives only, `false` non-decompression only. */
  decoDive?: boolean;
  /** Dives: minimum bottom time in seconds, inclusive. */
  minBottomTime?: number;
  /** Dives: maximum bottom time in seconds, inclusive. */
  maxBottomTime?: number;
}

/**
 * A workout done during an activity, from `getActivityWorkouts`: its name, sport and the steps the
 * device ran (`PersonalApi.ActivityWorkoutDTO`, matched key for key on a real account).
 */
export interface ActivityWorkout extends ActivityWorkoutDTO {}

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
