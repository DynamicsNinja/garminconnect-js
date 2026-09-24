/**
 * Courses (Garmin Connect "routes"): a saved track you can send to a device and follow.
 *
 * Shapes below are LIVE-OBSERVED on 2026-09-24 against the test account, not taken from any
 * upstream: python-garminconnect has no course methods at all.
 */

/** Course privacy, as this library names it. Garmin stores it as `rulePK`: public 1, private 2. */
export type CoursePrivacy = "private" | "public";

/**
 * One point of a course's track. `importCourseGpx` returns these RESAMPLED — a 13-point GPX came
 * back as 37 points — with `elevation` and `timestamp` null; Garmin fills elevation in on create.
 */
export interface CourseGeoPoint {
  latitude: number;
  longitude: number;
  elevation: number | null;
  distance: number | null;
  timestamp: number | null;
  [key: string]: unknown;
}

/** A waypoint on a course (a named point of interest). Passed through unchecked. */
export interface CoursePoint {
  [key: string]: unknown;
}

/**
 * A course record — what `getCourse`, `createCourse` and `importCourseGpx` return. On an
 * `importCourseGpx` result nothing is saved yet: `courseId` is `null` and so are the server-computed
 * fields such as `distanceMeter`.
 */
export interface Course {
  courseId: number | null;
  courseName: string | null;
  description: string | null;
  /** Privacy as stored: 1 public, 2 private. */
  rulePK: number | null;
  /** Garmin activity-type id — the `typeId` from `getActivityTypes()`. */
  activityTypePk: number | null;
  distanceMeter: number | null;
  elevationGainMeter: number | null;
  elevationLossMeter: number | null;
  geoPoints: CourseGeoPoint[];
  coursePoints: CoursePoint[];
  [key: string]: unknown;
}

/** One row of `listCourses()`. */
export interface CourseSummary {
  courseId: number;
  courseName: string;
  [key: string]: unknown;
}

/** `GET /web-gateway/course/owner/` — an ENVELOPE, not a bare array. */
export interface CourseList {
  coursesForUser: CourseSummary[];
  [key: string]: unknown;
}

/** What `createCourse` needs. Typically `geoPoints`/`coursePoints` come from `importCourseGpx`. */
export interface CourseInput {
  name: string;
  geoPoints: CourseGeoPoint[];
  coursePoints?: CoursePoint[];
  /** Garmin activity-type id (`getActivityTypes()`'s `typeId`). Default 1, running. */
  activityTypeId?: number;
  /** Default `"private"`. */
  privacy?: CoursePrivacy;
}

/** Fields `updateCourse` can change. Everything else on the record is carried over untouched. */
export interface CourseUpdate {
  name?: string;
  privacy?: CoursePrivacy;
}
