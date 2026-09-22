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
