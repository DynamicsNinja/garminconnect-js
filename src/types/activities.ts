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
 * Response shape of `GET /activity-service/activity/activityTypes` is undocumented
 * beyond "a dict" per the upstream method inventory — index signature only.
 */
export interface ActivityTypesResponse {
  [key: string]: unknown;
}

/** Result of `POST /upload-service/upload/{ext}` (`import_activity`). */
export interface ImportActivityResult {
  [key: string]: unknown;
}
