import { pathSegment, validateUuid } from "../util/validate.js";
import { GarminConnectionError, GarminError, GarminHttpError } from "../errors.js";
import type { GarminClient } from "../client.js";
import { formatDate } from "../util/date.js";
import type {
  Activity,
  ActivitiesForDateResponse,
  ActivityDetails,
  ActivityDownloadFormat,
  ActivityEventType,
  ActivityEventTypeKey,
  ActivityExerciseSets,
  ActivityFeel,
  ActivityGear,
  ActivityHrInTimezones,
  ActivityPowerInTimezones,
  ActivitySplits,
  ActivitySplitSummaries,
  ActivityTypedSplits,
  ActivityTypesResponse,
  ActivityWeather,
  GearActivity,
  GearLinkResult,
  ImportActivityResult,
  PersonalRecords,
  ProgressSummary,
  UploadActivityResult,
} from "../types/activities.js";

export interface ActivitiesHost {
  readonly client: GarminClient;
  /** Only needed by `getPersonalRecord`, which URLs by display name like the date-scoped methods. */
  displayName(): Promise<string>;
}

/** Returns the envelope's `totalCount`, not the whole response. */
export async function countActivities(host: ActivitiesHost): Promise<number> {
  const data = await host.client.connectapi<{ totalCount?: number }>(
    "/activitylist-service/activities/count",
  );
  if (!data || typeof data.totalCount !== "number") {
    throw new GarminError("No activities count data received");
  }
  return data.totalCount;
}

export async function getActivities(
  host: ActivitiesHost,
  start = 0,
  limit = 20,
): Promise<Activity[]> {
  const activities = await host.client.connectapi<Activity[]>(
    "/activitylist-service/activities/search/activities",
    { params: { start, limit } },
  );
  return activities ?? [];
}

export async function getActivity(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<Activity> {
  const activity = await host.client.connectapi<Activity>(
    `/activity-service/activity/${pathSegment(activityId)}`,
  );
  if (!activity) throw new GarminError(`No activity ${activityId} found`);
  return activity;
}

const DOWNLOAD_PATHS: Record<ActivityDownloadFormat, string> = {
  ORIGINAL: "/download-service/files/activity",
  TCX: "/download-service/export/tcx/activity",
  GPX: "/download-service/export/gpx/activity",
  KML: "/download-service/export/kml/activity",
  CSV: "/download-service/export/csv/activity",
};

export async function downloadActivity(
  host: ActivitiesHost,
  activityId: number | string,
  format: ActivityDownloadFormat = "ORIGINAL",
): Promise<Buffer> {
  const base = DOWNLOAD_PATHS[format];
  if (!base) {
    throw new GarminError(`Unknown download format "${format}"`);
  }
  return host.client.download(`${base}/${pathSegment(activityId)}`);
}

/**
 * Hits a `/mobile-gateway/heartRate/...` path despite the "activities" name
 * and despite this being the activities service — that is the real
 * endpoint, not a typo. `fordate` is routed through
 * `formatDate` like every other date-taking method in this library.
 */
export async function getActivitiesForDate(
  host: ActivitiesHost,
  fordate: string | Date,
): Promise<ActivitiesForDateResponse | null> {
  const date = formatDate(fordate);
  return host.client.connectapi<ActivitiesForDateResponse>(
    `/mobile-gateway/heartRate/forDate/${pathSegment(date)}`,
  );
}

/**
 * `getActivities` always coalesces to `[]` (never a dict-with-`activityList`-key
 * shape), so this only ever sees a bare array.
 */
export async function getLastActivity(host: ActivitiesHost): Promise<Activity | null> {
  const activities = await getActivities(host, 0, 1);
  return activities.length > 0 ? (activities[activities.length - 1] ?? null) : null;
}

/** Passes Garmin's response through unchecked. */
export async function getActivityTypes(
  host: ActivitiesHost,
): Promise<ActivityTypesResponse | null> {
  return host.client.connectapi<ActivityTypesResponse>(
    "/activity-service/activity/activityTypes",
  );
}

/**
 * Returns Garmin's raw response: `connectapi`'s own null-on-204/empty-body
 * result is passed straight through rather than turned into a throw.
 */
export async function deleteActivity(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<unknown> {
  return host.client.connectapi(`/activity-service/activity/${pathSegment(activityId)}`, {
    method: "DELETE",
  });
}

/** Returns Garmin's raw response. */
export async function setActivityName(
  host: ActivitiesHost,
  activityId: number | string,
  activityName: string,
): Promise<unknown> {
  return host.client.connectapi(`/activity-service/activity/${pathSegment(activityId)}`, {
    method: "PUT",
    json: { activityId, activityName },
  });
}

/** Returns Garmin's raw response. */
export async function setActivityType(
  host: ActivitiesHost,
  activityId: number | string,
  typeId: number,
  typeKey: string,
  parentTypeId: number,
): Promise<unknown> {
  return host.client.connectapi(`/activity-service/activity/${pathSegment(activityId)}`, {
    method: "PUT",
    json: {
      activityId,
      activityTypeDTO: { typeId, typeKey, parentTypeId },
    },
  });
}

/** Returns Garmin's raw response. */
export async function setActivityDescription(
  host: ActivitiesHost,
  activityId: number | string,
  description: string,
): Promise<unknown> {
  return host.client.connectapi(`/activity-service/activity/${pathSegment(activityId)}`, {
    method: "PUT",
    json: { activityId, description },
  });
}

// ---------------------------------------------------------------------------
// Event type, perceived effort and feel. Each verified live on 2026-10-06 (set, read back through
// getActivity, restore). All three are PARTIAL updates through the same
// `PUT /activity-service/activity/{id}` setActivityName uses: Garmin merges the fields it is sent.
// Never read-modify-write the whole summaryDTO instead — PUTting the stored
// startLatitude/startLongitude pair back is rejected with a 400.
// ---------------------------------------------------------------------------

const ACTIVITY_EVENT_TYPE_KEYS: ReadonlySet<string> = new Set<ActivityEventTypeKey>([
  "race",
  "recreation",
  "specialEvent",
  "training",
  "transportation",
  "touring",
  "geocaching",
  "fitness",
  "uncategorized",
]);

const ACTIVITY_FEELS: ReadonlySet<number> = new Set<ActivityFeel>([0, 25, 50, 75, 100]);

/** `GET /activity-service/activity/eventTypes` — the event types `setActivityEventType` accepts. */
export async function getActivityEventTypes(host: ActivitiesHost): Promise<ActivityEventType[] | null> {
  return host.client.connectapi<ActivityEventType[]>("/activity-service/activity/eventTypes");
}

/**
 * Files an activity under an event type ("race", "training", …). Sends `eventTypeDTO` with the
 * `typeKey` only: Garmin fills in `typeId` and `sortOrder` itself, verified by read-back.
 */
export async function setActivityEventType(
  host: ActivitiesHost,
  activityId: number | string,
  eventType: ActivityEventTypeKey,
): Promise<unknown> {
  if (!ACTIVITY_EVENT_TYPE_KEYS.has(eventType)) {
    throw new GarminError(
      `Unknown activity event type "${String(eventType)}" — expected one of ` +
        `${[...ACTIVITY_EVENT_TYPE_KEYS].join(", ")}`,
    );
  }
  return host.client.connectapi(`/activity-service/activity/${pathSegment(activityId)}`, {
    method: "PUT",
    json: { activityId, eventTypeDTO: { typeKey: eventType } },
  });
}

/**
 * Sets an activity's perceived effort (RPE) on Garmin Connect's 1-10 scale, or clears it with
 * `null`. Garmin stores it TIMES TEN as `summaryDTO.directWorkoutRpe` (RPE 7 reads back as 70);
 * this method does the conversion, so pass the 1-10 value, not the stored one.
 */
export async function setActivityPerceivedEffort(
  host: ActivitiesHost,
  activityId: number | string,
  rpe: number | null,
): Promise<unknown> {
  if (rpe !== null && (!Number.isInteger(rpe) || rpe < 1 || rpe > 10)) {
    throw new GarminError(`rpe must be an integer from 1 to 10, or null to clear it; got ${String(rpe)}`);
  }
  return host.client.connectapi(`/activity-service/activity/${pathSegment(activityId)}`, {
    method: "PUT",
    json: { activityId, summaryDTO: { directWorkoutRpe: rpe === null ? null : rpe * 10 } },
  });
}

/**
 * Sets an activity's "How did you feel?" rating (`summaryDTO.directWorkoutFeel`), or clears it
 * with `null`. Only Garmin Connect's five steps are accepted. Garmin itself stores any number it
 * is sent (30 read back as 30), which its own apps then cannot display.
 */
export async function setActivityFeel(
  host: ActivitiesHost,
  activityId: number | string,
  feel: ActivityFeel | null,
): Promise<unknown> {
  if (feel !== null && !ACTIVITY_FEELS.has(feel)) {
    throw new GarminError(`feel must be one of 0, 25, 50, 75, 100, or null to clear it; got ${String(feel)}`);
  }
  return host.client.connectapi(`/activity-service/activity/${pathSegment(activityId)}`, {
    method: "PUT",
    json: { activityId, summaryDTO: { directWorkoutFeel: feel } },
  });
}

/**
 * Low-level entry point: `payload` is sent to Garmin verbatim, no shape
 * validation. `createManualActivity` builds on top of this. Returns Garmin's
 * raw response.
 */
export async function createManualActivityFromJson(
  host: ActivitiesHost,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return host.client.connectapi("/activity-service/activity", {
    method: "POST",
    json: payload,
  });
}

/**
 * CONVERTS units before sending — the opposite direction from `addWeighIn`.
 * `distanceKm` (km) is multiplied by 1000 to become the wire `distance`
 * (meters); `durationMin` (minutes) is multiplied by 60 to become the wire
 * `duration` (seconds). Getting this backwards silently corrupts the
 * stored activity's distance/duration by 1000x/60x.
 *
 * `startDatetime` is passed through unmodified, NOT routed through
 * `formatDate`: it is Garmin's local start-time format, not a `YYYY-MM-DD`
 * calendar date, so `formatDate`'s stricter date-only validation would
 * reject a legitimate value. It MUST include milliseconds, e.g.
 * `"2026-09-22T09:00:00.000"` — live-verified against the Garmin test account:
 * omitting the `.000` produced an HTTP 500 `ValueInstantiationException`
 * from Garmin, while the same body with `.000` appended succeeded.
 *
 * `typeKey` is the Garmin activity type key WITHOUT the `activity_type_`
 * prefix (e.g. `"resort_skiing"`).
 */
export async function createManualActivity(
  host: ActivitiesHost,
  startDatetime: string,
  timeZone: string,
  typeKey: string,
  distanceKm: number,
  durationMin: number,
  activityName: string,
): Promise<unknown> {
  const payload = {
    activityTypeDTO: { typeKey },
    accessControlRuleDTO: { typeId: 2, typeKey: "private" },
    timeZoneUnitDTO: { unitKey: timeZone },
    activityName,
    metadataDTO: { autoCalcCalories: true },
    summaryDTO: {
      startTimeLocal: startDatetime,
      distance: distanceKm * 1000,
      duration: durationMin * 60,
    },
  };
  return createManualActivityFromJson(host, payload);
}

const ACTIVITIES_BY_DATE_PAGE_SIZE = 20;
/** Safety cap on the number of pages fetched. */
const MAX_PAGINATED_REQUESTS = 2000;

/**
 * Paginates internally: fetches fixed pages of
 * `ACTIVITIES_BY_DATE_PAGE_SIZE` (20), incrementing `start` by that amount
 * each call, until a page comes back empty/falsy (the normal end of data)
 * or `MAX_PAGINATED_REQUESTS` pages have been fetched without ever seeing
 * an empty page (an abort-with-error safety cap, not a normal outcome).
 */
export async function getActivitiesByDate(
  host: ActivitiesHost,
  startdate: string | Date,
  enddate?: string | Date,
  activitytype?: string,
  sortorder?: string,
): Promise<Activity[]> {
  const startDate = formatDate(startdate);
  const endDate = enddate !== undefined ? formatDate(enddate) : undefined;
  const results: Activity[] = [];
  let start = 0;
  let sawEmptyPage = false;

  for (let page = 0; page < MAX_PAGINATED_REQUESTS; page++) {
    const batch = await host.client.connectapi<Activity[]>(
      "/activitylist-service/activities/search/activities",
      {
        params: {
          startDate,
          start,
          limit: ACTIVITIES_BY_DATE_PAGE_SIZE,
          endDate,
          activityType: activitytype,
          sortOrder: sortorder,
        },
      },
    );
    if (!batch || batch.length === 0) {
      sawEmptyPage = true;
      break;
    }
    results.push(...batch);
    start += ACTIVITIES_BY_DATE_PAGE_SIZE;
  }

  if (!sawEmptyPage) {
    throw new GarminError(`Pagination exceeded ${MAX_PAGINATED_REQUESTS} requests; aborting`);
  }
  return results;
}

const IMPORT_UPLOAD_HEADERS: Record<string, string> = {
  NK: "NT",
  origin: "https://sso.garmin.com",
  "User-Agent": "GCM-iOS-5.7.2.1",
};

const IMPORT_ACTIVITY_EXTENSIONS = new Set(["fit", "gpx", "tcx"]);

/**
 * Distinct endpoint and headers from a plain device-sync upload
 * (`client.upload()`'s default path): the `NK`/`origin`/custom `User-Agent`
 * headers are load-bearing — without them Garmin treats the request as an
 * ordinary device sync rather than an import.
 */
export async function importActivity(
  host: ActivitiesHost,
  file: Blob,
  filename: string,
): Promise<ImportActivityResult> {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === filename.length - 1) {
    throw new GarminError(`Cannot determine file extension from "${filename}"`);
  }
  const extension = filename.slice(dotIndex + 1).toLowerCase();
  if (!IMPORT_ACTIVITY_EXTENSIONS.has(extension)) {
    throw new GarminError(
      `Unsupported activity file format ".${extension}" — expected fit, gpx, or tcx`,
    );
  }

  try {
    const result = await host.client.upload(file, filename, `/upload-service/upload/${pathSegment(extension)}`, {
      headers: IMPORT_UPLOAD_HEADERS,
    });
    // An empty body (`upload()` returns `null`) synthesizes this fallback
    // instead of raising.
    if (result && typeof result === "object") {
      return result as ImportActivityResult;
    }
    return { status: "uploaded", fileName: filename };
  } catch (cause) {
    if (cause instanceof GarminHttpError && cause.status === 409) {
      throw new GarminConnectionError(`Activity already exists (duplicate): ${filename}`, {
        cause,
      });
    }
    if (cause instanceof GarminHttpError || cause instanceof GarminConnectionError) {
      throw new GarminConnectionError(`Import error: ${cause.message}`, { cause });
    }
    throw cause;
  }
}

// --- per-activity detail sub-resources ---

/** Passes Garmin's response through unchecked. */
export async function getActivitySplits(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<ActivitySplits | null> {
  return host.client.connectapi<ActivitySplits>(`/activity-service/activity/${pathSegment(activityId)}/splits`);
}

/** Passes Garmin's response through unchecked. Richer detail than `getActivitySplits` for some activity types (e.g. Bouldering). */
export async function getActivityTypedSplits(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<ActivityTypedSplits | null> {
  return host.client.connectapi<ActivityTypedSplits>(
    `/activity-service/activity/${pathSegment(activityId)}/typedsplits`,
  );
}

/** Passes Garmin's response through unchecked. */
export async function getActivitySplitSummaries(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<ActivitySplitSummaries | null> {
  return host.client.connectapi<ActivitySplitSummaries>(
    `/activity-service/activity/${pathSegment(activityId)}/split_summaries`,
  );
}

/** Passes Garmin's response through unchecked. */
export async function getActivityWeather(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<ActivityWeather | null> {
  return host.client.connectapi<ActivityWeather>(`/activity-service/activity/${pathSegment(activityId)}/weather`);
}

/** Passes Garmin's response through unchecked. */
export async function getActivityHrInTimezones(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<ActivityHrInTimezones | null> {
  return host.client.connectapi<ActivityHrInTimezones>(
    `/activity-service/activity/${pathSegment(activityId)}/hrTimeInZones`,
  );
}

/** Passes Garmin's response through unchecked. */
export async function getActivityPowerInTimezones(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<ActivityPowerInTimezones | null> {
  return host.client.connectapi<ActivityPowerInTimezones>(
    `/activity-service/activity/${pathSegment(activityId)}/powerTimeInZones`,
  );
}

/**
 * Passes Garmin's response through unchecked. `maxchart` and `maxpoly` are not validated
 * client-side — an invalid value is Garmin's to reject.
 */
export async function getActivityDetails(
  host: ActivitiesHost,
  activityId: number | string,
  maxchart = 2000,
  maxpoly = 4000,
): Promise<ActivityDetails | null> {
  return host.client.connectapi<ActivityDetails>(`/activity-service/activity/${pathSegment(activityId)}/details`, {
    params: { maxChartSize: String(maxchart), maxPolylineSize: String(maxpoly) },
  });
}

/** Passes Garmin's response through unchecked. */
export async function getActivityExerciseSets(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<ActivityExerciseSets | null> {
  return host.client.connectapi<ActivityExerciseSets>(
    `/activity-service/activity/${pathSegment(activityId)}/exerciseSets`,
  );
}

/**
 * Returns Garmin's raw response.
 * **Replace-all semantics** — `payload` fully overwrites the existing `exerciseSets` array on
 * Garmin's side, it is not merged. Garmin validates `exercises[].category`/`exercises[].name`
 * against its FIT enum server-side (400 "Invalid Sub-Category Passed" on unknown values).
 */
export async function setActivityExerciseSets(
  host: ActivitiesHost,
  activityId: number | string,
  payload: ActivityExerciseSets,
): Promise<unknown> {
  return host.client.connectapi(`/activity-service/activity/${pathSegment(activityId)}/exerciseSets`, {
    method: "PUT",
    json: payload,
  });
}

/**
 * Reuses `getGear`'s base URL (`/gear-service/gear/filterGear`) with an `activityId` query param
 * instead of `userProfilePk`. The activity/gear-association methods live in this service rather
 * than the dedicated gear service (`src/services/gear.ts`).
 *
 * Returns an ARRAY (`ActivityGear[]`), not a single object — confirmed live (see `ActivityGear`'s
 * doc comment in `src/types/activities.ts`).
 */
export async function getActivityGear(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<ActivityGear[] | null> {
  return host.client.connectapi<ActivityGear[]>("/gear-service/gear/filterGear", {
    params: { activityId },
  });
}

const GEAR_ACTIVITIES_MAX_LIMIT = 1000;

/**
 * `limit` is clamped to `GEAR_ACTIVITIES_MAX_LIMIT` (1000). On a 404, returns `[]` rather than
 * raising; other errors are re-raised as-is.
 */
export async function getGearActivities(
  host: ActivitiesHost,
  gearUUID: string,
  limit = 1000,
): Promise<GearActivity[]> {
  const cappedLimit = Math.min(limit, GEAR_ACTIVITIES_MAX_LIMIT);
  const uuid = validateUuid(gearUUID);
  try {
    const data = await host.client.connectapi<GearActivity[]>(
      `/activitylist-service/activities/${pathSegment(uuid)}/gear`,
      { params: { start: 0, limit: cappedLimit } },
    );
    return data ?? [];
  } catch (cause) {
    if (cause instanceof GarminHttpError && cause.status === 404) {
      return [];
    }
    throw cause;
  }
}

/**
 * On 404, re-raised as `GarminConnectionError` with a "gear not found (likely retired/removed)"
 * message; other errors re-raised as-is.
 */
export async function addGearToActivity(
  host: ActivitiesHost,
  gearUUID: string,
  activityId: number | string,
): Promise<GearLinkResult | null> {
  const uuid = validateUuid(gearUUID);
  try {
    return await host.client.connectapi<GearLinkResult>(
      `/gear-service/gear/link/${pathSegment(uuid)}/activity/${pathSegment(activityId)}`,
      { method: "PUT" },
    );
  } catch (cause) {
    if (cause instanceof GarminHttpError && cause.status === 404) {
      throw new GarminConnectionError(
        `Cannot add gear ${gearUUID} to activity ${activityId}: gear not found (likely retired/removed)`,
        { cause },
      );
    }
    throw cause;
  }
}

/**
 * Note: unlinking is also a **PUT**, not a DELETE. Same 404-handling
 * pattern as `addGearToActivity`, with a "remove ... from activity" message.
 */
export async function removeGearFromActivity(
  host: ActivitiesHost,
  gearUUID: string,
  activityId: number | string,
): Promise<GearLinkResult | null> {
  const uuid = validateUuid(gearUUID);
  try {
    return await host.client.connectapi<GearLinkResult>(
      `/gear-service/gear/unlink/${pathSegment(uuid)}/activity/${pathSegment(activityId)}`,
      { method: "PUT" },
    );
  } catch (cause) {
    if (cause instanceof GarminHttpError && cause.status === 404) {
      throw new GarminConnectionError(
        `Cannot remove gear ${gearUUID} from activity ${activityId}: gear not found (likely retired/removed)`,
        { cause },
      );
    }
    throw cause;
  }
}

/** Passes Garmin's response through unchecked. Both dates are routed through `formatDate`. */
export async function getProgressSummaryBetweenDates(
  host: ActivitiesHost,
  startdate: string | Date,
  enddate: string | Date,
  metric = "distance",
  groupbyactivities = true,
): Promise<ProgressSummary | null> {
  const startDate = formatDate(startdate);
  const endDate = formatDate(enddate);
  return host.client.connectapi<ProgressSummary>("/fitnessstats-service/activity", {
    params: {
      startDate,
      endDate,
      aggregation: "lifetime",
      groupByParentActivityType: String(groupbyactivities),
      metric,
    },
  });
}

/**
 * Routed through `client.download`. Returns a ZIP file's raw bytes, matching `downloadActivity`'s `ORIGINAL` format.
 */
export async function downloadHealthSnapshot(
  host: ActivitiesHost,
  requestedDate: string | Date,
): Promise<Buffer> {
  const date = formatDate(requestedDate);
  return host.client.download(`/download-service/files/wellness/${pathSegment(date)}`);
}

/**
 * Keys off `displayName()`, like the date-scoped methods. Passes Garmin's response through
 * unchecked.
 */
export async function getPersonalRecord(host: ActivitiesHost): Promise<PersonalRecords | null> {
  const displayName = await host.displayName();
  return host.client.connectapi<PersonalRecords>(
    `/personalrecord-service/personalrecord/prs/${pathSegment(displayName)}`,
  );
}

/**
 * `uploadActivity` and `importActivity` accept the same file formats, so this alias is not a
 * placeholder for a future divergence — it exists to make the shared constraint explicit at both
 * call sites rather than having one method reach into a constant named for the other.
 */
const UPLOAD_ACTIVITY_EXTENSIONS = IMPORT_ACTIVITY_EXTENSIONS;

/**
 * **Distinct from `importActivity`**: this hits the PLAIN `/upload-service/upload` path with no
 * file-extension suffix and none of `importActivity`'s load-bearing `NK`/`origin`/custom
 * `User-Agent` headers — this is the ordinary device-sync-shaped upload, while `importActivity`
 * is the one that spoofs a different client to make Garmin treat it as an import. Do not conflate
 * the two; sending the import headers here (or omitting them from `importActivity`) would swap
 * their observed behaviour.
 *
 * Takes a `Blob`, the same convention as `importActivity` (this library targets a server runtime,
 * not a CLI with a trusted local filesystem) — a caller on Node can build one from a file
 * trivially (`new Blob([await readFile(path)])`).
 *
 * Returns Garmin's raw response.
 */
export async function uploadActivity(
  host: ActivitiesHost,
  file: Blob,
  filename: string,
): Promise<UploadActivityResult | null> {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === filename.length - 1) {
    throw new GarminError(`Cannot determine file extension from "${filename}"`);
  }
  const extension = filename.slice(dotIndex + 1).toLowerCase();
  if (!UPLOAD_ACTIVITY_EXTENSIONS.has(extension)) {
    throw new GarminError(
      `Unsupported activity file format ".${extension}" — expected fit, gpx, or tcx`,
    );
  }
  const result = await host.client.upload(file, filename);
  return (result as UploadActivityResult | null) ?? null;
}
