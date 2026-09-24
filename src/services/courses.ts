import { GarminError } from "../errors.js";
import type { GarminClient } from "../client.js";
import { pathSegment } from "../util/validate.js";
import type {
  Course,
  CourseInput,
  CourseList,
  CoursePrivacy,
  CourseUpdate,
} from "../types/courses.js";

/**
 * Courses — saved tracks you can send to a device and follow.
 *
 * **NOT upstream parity**: python-garminconnect has no course methods. The endpoints come from the
 * `florianpasteur/garmin-connect` JavaScript fork, and every one of them was re-verified here,
 * live, on 2026-09-24 by a create -> read back -> update -> read back -> export -> delete round-trip on the test
 * account (`npm run smoke:gaps`). `deleteCourse` has no counterpart in that fork either.
 *
 * Creating a course is TWO calls. `importCourseGpx` uploads the GPX and gets back the parsed,
 * resampled track WITHOUT saving anything (`courseId: null`); `createCourse` then posts that track
 * as a new course. `createCourseFromGpx` does both.
 *
 * **"Not yet ready" (HTTP 429).** Garmin processes a new course in the background, and until that
 * finishes, `PUT` and `DELETE` answer 429 `"The course [id] is not yet ready to delete or update"`
 * (a `TooManyRequestsException`, surfaced as `GarminRateLimitError` — it is not rate limiting).
 * For a track on land it clears within seconds: a rename 5s after creation succeeded. For a track
 * in open water it NEVER cleared for updates — a probe course at 0°N 0°E still refused a PUT
 * after five minutes, which is how this was first misread as "the PUT does not work". Garmin's
 * own web editor, observed on 2026-09-24, saves with the same full-record PUT this library sends.
 */
export interface CoursesHost {
  readonly client: GarminClient;
}

const PRIVACY_RULE: Record<CoursePrivacy, number> = { public: 1, private: 2 };

function privacyRule(privacy: CoursePrivacy): number {
  const rule = PRIVACY_RULE[privacy];
  if (rule === undefined) {
    throw new GarminError(`Unknown course privacy "${String(privacy)}" — expected "private" or "public"`);
  }
  return rule;
}

/** `GET /web-gateway/course/owner/`. An envelope: the courses are under `coursesForUser`. */
export async function listCourses(host: CoursesHost): Promise<CourseList | null> {
  return host.client.connectapi<CourseList>("/web-gateway/course/owner/");
}

/** `GET /course-service/course/{courseId}`. A missing id is a 404 (`GarminHttpError`). */
export async function getCourse(host: CoursesHost, courseId: number | string): Promise<Course | null> {
  return host.client.connectapi<Course>(`/course-service/course/${pathSegment(courseId)}`);
}

/**
 * `POST /course-service/course/import` (multipart, field `file`). Parses a GPX file into a course
 * record and saves NOTHING — the result has `courseId: null`. Pass its `geoPoints` and
 * `coursePoints` to `createCourse`, or use `createCourseFromGpx`.
 *
 * The track comes back resampled (13 GPX points became 37) with `elevation` and `timestamp` null,
 * and `courseName` taken from the GPX `<name>`. Only `.gpx` has been verified, so only `.gpx` is
 * accepted.
 */
export async function importCourseGpx(
  host: CoursesHost,
  file: Blob,
  filename: string,
): Promise<Course> {
  if (!filename.toLowerCase().endsWith(".gpx")) {
    throw new GarminError(`importCourseGpx expects a .gpx file, got "${filename}"`);
  }
  const result = await host.client.upload(file, filename, "/course-service/course/import");
  if (!result || typeof result !== "object") {
    throw new GarminError(`Garmin returned no parsed course for "${filename}"`);
  }
  return result as Course;
}

/**
 * `POST /course-service/course`. Saves a new course and returns it with its `courseId` and the
 * server-computed `distanceMeter` and elevation totals.
 *
 * The body is the template Garmin's own web client sends; only the name, track, activity type and
 * privacy vary. `activityTypeId` is a Garmin activity-type id (`getActivityTypes()`'s `typeId`),
 * default 1 (running).
 */
export async function createCourse(host: CoursesHost, input: CourseInput): Promise<Course | null> {
  if (!input.name.trim()) throw new GarminError("createCourse requires a non-empty name");
  if (input.geoPoints.length < 2) {
    throw new GarminError("createCourse requires at least two geoPoints");
  }
  const body = {
    activityTypePk: input.activityTypeId ?? 1,
    hasTurnDetectionDisabled: false,
    geoPoints: input.geoPoints,
    courseLines: [],
    coursePoints: input.coursePoints ?? [],
    startPoint: input.geoPoints[0],
    elapsedSeconds: null,
    openStreetMap: false,
    coordinateSystem: "WGS84",
    rulePK: privacyRule(input.privacy ?? "private"),
    courseName: input.name,
    matchedToSegments: false,
    includeLaps: false,
    hasPaceBand: false,
    hasPowerGuide: false,
    favorite: false,
    speedMeterPerSecond: null,
    sourceTypeId: 3,
  };
  return host.client.connectapi<Course>("/course-service/course", { method: "POST", json: body });
}

/**
 * `importCourseGpx` then `createCourse`. The name defaults to the GPX track's own `<name>`, then to
 * the filename without its extension.
 */
export async function createCourseFromGpx(
  host: CoursesHost,
  file: Blob,
  filename: string,
  options: Omit<CourseInput, "geoPoints" | "coursePoints" | "name"> & { name?: string } = {},
): Promise<Course | null> {
  const parsed = await importCourseGpx(host, file, filename);
  const name = options.name ?? parsed.courseName ?? filename.replace(/\.gpx$/i, "");
  return createCourse(host, {
    ...options,
    name,
    geoPoints: parsed.geoPoints,
    coursePoints: parsed.coursePoints,
  });
}

/**
 * Renames a course and/or changes its privacy.
 *
 * READ-MODIFY-WRITE, like `setGearActivityDefaults`: GETs the current record, overlays the changes,
 * and PUTs the whole record back to `/course-service/course/{courseId}` — the same request Garmin's
 * own web editor sends on Save. Two concurrent callers can clobber each other; every field not
 * named in `changes` is carried over untouched. A just-created course may 429 "not yet ready";
 * see the note at the top of this file.
 */
export async function updateCourse(
  host: CoursesHost,
  courseId: number | string,
  changes: CourseUpdate,
): Promise<Course | null> {
  if (changes.name === undefined && changes.privacy === undefined) {
    throw new GarminError("updateCourse needs at least one of name or privacy");
  }
  if (changes.name !== undefined && !changes.name.trim()) {
    throw new GarminError("updateCourse cannot set an empty name");
  }
  const path = `/course-service/course/${pathSegment(courseId)}`;
  const current = await host.client.connectapi<Course>(path);
  if (!current) throw new GarminError(`Cannot update course ${String(courseId)}: Garmin returned nothing`);
  const body: Course = { ...current };
  if (changes.name !== undefined) body.courseName = changes.name;
  if (changes.privacy !== undefined) body.rulePK = privacyRule(changes.privacy);
  return host.client.connectapi<Course>(path, { method: "PUT", json: body });
}

/**
 * `DELETE /course-service/course/{courseId}`. Resolves to `null` on success; a later `getCourse`
 * on the same id is a 404. IRREVERSIBLE.
 *
 * A course created a moment ago may 429 "not yet ready"; retry a few seconds later. See the note
 * at the top of this file.
 */
export async function deleteCourse(host: CoursesHost, courseId: number | string): Promise<unknown> {
  return host.client.connectapi(`/course-service/course/${pathSegment(courseId)}`, {
    method: "DELETE",
  });
}

/** `GET /course-service/course/gpx/{courseId}` — the course as GPX file bytes. */
export async function downloadCourseGpx(host: CoursesHost, courseId: number | string): Promise<Buffer> {
  return host.client.download(`/course-service/course/gpx/${pathSegment(courseId)}`);
}
