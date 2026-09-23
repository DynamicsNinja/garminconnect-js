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
 * Result of `POST /upload-service/upload` (`upload_activity`) — the plain, non-import upload
 * (distinct endpoint and headers from `importActivity`, see that function's doc comment). Upstream
 * returns "Any (raw client response)"; UNCERTAIN null handling. Undocumented shape.
 */
export interface UploadActivityResult {
  [key: string]: unknown;
}

/**
 * `GET /personalrecord-service/personalrecord/prs/{displayName}` (`get_personal_record`). Passes
 * through unchecked. **The upstream inventory's `returns` column says "dict"; live-verified
 * WRONG against the Garmin test account (`array[0]`) — another instance of this project's
 * standing "the returns column is unreliable" finding.** Per upstream's notes, for
 * `activityType === "running"`, `typeId` maps 1=1km, 2=1mile, 3=5km, 4=10km, 5=half marathon,
 * 6=marathon, 7=longest run (distance in meters; duration would need a separate `getActivity`
 * call) — not modeled as fields here since the test account has zero personal records, but
 * recorded for a caller reading the raw response.
 */
/** One personal-record row. Shape unobserved — the test account has no records. */
export type PersonalRecord = Record<string, unknown>;

/**
 * What `getPersonalRecord` actually returns: an ARRAY, despite the inventory's `dict` label and
 * despite upstream's singular method name (live-observed as `array[0]`). Named plural so the call
 * site cannot be misread as returning a single record — the same singular-row/plural-result split
 * applied to `Gear` and `GearDefaults` in Task 7.
 */
export type PersonalRecords = PersonalRecord[];

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

/**
 * One entry of `GET /gear-service/gear/filterGear?activityId=...` (`get_activity_gear`). The
 * endpoint returns a JSON ARRAY of these, not a single object — confirmed live in Task 7's
 * fix-round-1 (the sibling `userProfilePk`-filtered call on the same base URL, `get_gear`, was
 * already found to return an array; a follow-up live call with `activityId` confirmed the same
 * shape), despite the inventory listing its return type as "dict". `getActivityGear` below returns
 * `ActivityGear[] | null` accordingly.
 */
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
