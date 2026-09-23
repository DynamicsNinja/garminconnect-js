import { pathSegment, validateUuid } from "../util/validate.js";
import { GarminConnectionError, GarminError, GarminHttpError } from "../errors.js";
import type { GarminClient } from "../client.js";
import { formatDate } from "../util/date.js";
import type {
  Activity,
  ActivitiesForDateResponse,
  ActivityDetails,
  ActivityDownloadFormat,
  ActivityExerciseSets,
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

/** Upstream `count_activities`: returns the envelope's `totalCount`, not the whole response. */
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
 * Upstream's `garmin_connect_activity_fordate` constant points at a
 * `/mobile-gateway/heartRate/...` path despite the "activities" name and
 * despite this being the activities service — transcribed verbatim from the
 * inventory, not a typo introduced here. `fordate` is routed through
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
 * Handles both response shapes `get_activities` can (in principle) hand
 * back upstream. In this port `getActivities` always coalesces to `[]`
 * (never the dict-with-`activityList`-key shape), so only the bare-array
 * branch is reachable here — kept for parity with upstream's defensive
 * handling of both shapes.
 */
export async function getLastActivity(host: ActivitiesHost): Promise<Activity | null> {
  const activities = await getActivities(host, 0, 1);
  return activities.length > 0 ? (activities[activities.length - 1] ?? null) : null;
}

/** `dict`, passes through unchecked per the inventory. */
export async function getActivityTypes(
  host: ActivitiesHost,
): Promise<ActivityTypesResponse | null> {
  return host.client.connectapi<ActivityTypesResponse>(
    "/activity-service/activity/activityTypes",
  );
}

/**
 * UNCERTAIN (inventory): "no explicit null handling, returns raw response".
 * `client.py`'s exact behaviour on a non-2xx/empty body was not reviewed;
 * this passes `connectapi`'s own null-on-204/empty-body result straight
 * through rather than inventing a throw.
 */
export async function deleteActivity(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<unknown> {
  return host.client.connectapi(`/activity-service/activity/${pathSegment(activityId)}`, {
    method: "DELETE",
  });
}

/** UNCERTAIN (inventory): "no explicit null handling, returns raw response". */
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

/** UNCERTAIN (inventory): "no explicit null handling, returns raw response". */
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

/** UNCERTAIN (inventory): "no explicit null handling, returns raw response". */
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

/**
 * Low-level entry point: `payload` is sent to Garmin verbatim, no shape
 * validation. `create_manual_activity` builds on top of this.
 * UNCERTAIN (inventory): "no explicit null handling, returns raw response".
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
 * `formatDate`: upstream types it as a bare `str` (Garmin's local
 * start-time format), not a `YYYY-MM-DD` calendar date, so `formatDate`'s
 * stricter date-only validation would reject a legitimate value. It MUST
 * include milliseconds, e.g. `"2026-09-22T09:00:00.000"` (upstream's
 * documented pattern) — live-verified against the Garmin test account:
 * omitting the `.000` produced an HTTP 500 `ValueInstantiationException`
 * from Garmin, while the same body with `.000` appended succeeded.
 *
 * `typeKey` is the Garmin activity type key WITHOUT the `activity_type_`
 * prefix (e.g. `"resort_skiing"`), per the inventory notes.
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
/** Matches upstream's `MAX_PAGINATED_REQUESTS` safety cap. */
const MAX_PAGINATED_REQUESTS = 2000;

/**
 * Replicates upstream's internal pagination loop: fetches fixed pages of
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
 * ordinary device sync rather than an import, per the inventory notes.
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
    // Upstream: "if the client response has no `.json` attribute" (e.g. an
    // empty body) it synthesizes this fallback instead of raising. Our
    // `upload()` returns `null` in the equivalent case.
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

// --- per-activity detail sub-resources (Task 4) ---

/** `dict`, passes through unchecked per the inventory. */
export async function getActivitySplits(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<ActivitySplits | null> {
  return host.client.connectapi<ActivitySplits>(`/activity-service/activity/${pathSegment(activityId)}/splits`);
}

/** `dict`, passes through unchecked per the inventory. Richer detail than `getActivitySplits` for some activity types (e.g. Bouldering). */
export async function getActivityTypedSplits(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<ActivityTypedSplits | null> {
  return host.client.connectapi<ActivityTypedSplits>(
    `/activity-service/activity/${pathSegment(activityId)}/typedsplits`,
  );
}

/** `dict`, passes through unchecked per the inventory. */
export async function getActivitySplitSummaries(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<ActivitySplitSummaries | null> {
  return host.client.connectapi<ActivitySplitSummaries>(
    `/activity-service/activity/${pathSegment(activityId)}/split_summaries`,
  );
}

/** `dict`, passes through unchecked per the inventory. */
export async function getActivityWeather(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<ActivityWeather | null> {
  return host.client.connectapi<ActivityWeather>(`/activity-service/activity/${pathSegment(activityId)}/weather`);
}

/** `dict`, passes through unchecked per the inventory. */
export async function getActivityHrInTimezones(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<ActivityHrInTimezones | null> {
  return host.client.connectapi<ActivityHrInTimezones>(
    `/activity-service/activity/${pathSegment(activityId)}/hrTimeInZones`,
  );
}

/** `dict`, passes through unchecked per the inventory. */
export async function getActivityPowerInTimezones(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<ActivityPowerInTimezones | null> {
  return host.client.connectapi<ActivityPowerInTimezones>(
    `/activity-service/activity/${pathSegment(activityId)}/powerTimeInZones`,
  );
}

/**
 * `dict`, passes through unchecked per the inventory. Upstream validates `maxchart` positive and
 * `maxpoly` non-negative before the call; this port does not re-validate (matching the "no
 * explicit null handling" posture applied elsewhere in this file for un-reviewed edge cases) —
 * an invalid value is Garmin's problem to reject, not re-validated client-side here.
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

/** `dict`, passes through unchecked per the inventory. */
export async function getActivityExerciseSets(
  host: ActivitiesHost,
  activityId: number | string,
): Promise<ActivityExerciseSets | null> {
  return host.client.connectapi<ActivityExerciseSets>(
    `/activity-service/activity/${pathSegment(activityId)}/exerciseSets`,
  );
}

/**
 * UNCERTAIN (inventory): "no explicit null handling, returns raw response".
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
 * Inventory places this row under the "gear" section, not "activities" — reuses `get_gear`'s base
 * URL (`/gear-service/gear/filterGear`) with an `activityId` query param instead of `userProfilePk`.
 * Implemented here per the task brief, which assigns the activity/gear-association methods to this
 * service rather than the dedicated gear service (`src/services/gear.ts`, ported in Task 7).
 *
 * Returns an ARRAY (`ActivityGear[]`), not a single object — confirmed live in Task 7's
 * fix-round-1 (see `ActivityGear`'s doc comment in `src/types/activities.ts`); this was fixed from
 * an earlier `ActivityGear | null` signature that mistyped it as a single object.
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
 * Inventory places this row under the "gear" section — see `getActivityGear`'s note.
 * `limit` is clamped to `GEAR_ACTIVITIES_MAX_LIMIT` (1000), matching upstream. On a 404, upstream
 * logs a warning and returns `[]` rather than raising; other errors are re-raised as-is.
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
 * Inventory places this row under the "gear" section — see `getActivityGear`'s note.
 * On 404, re-raised as `GarminConnectionError` with a "gear not found (likely retired/removed)"
 * message, matching upstream; other errors re-raised as-is.
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
 * Inventory places this row under the "gear" section — see `getActivityGear`'s note.
 * Note: unlinking is also a **PUT**, not a DELETE, matching upstream exactly. Same 404-handling
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

/** `dict`, passes through unchecked per the inventory. Both dates are routed through `formatDate`. */
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
 * UNCERTAIN (inventory): routed through `client.download`, no null-handling visible upstream.
 * Returns a ZIP file's raw bytes, matching `downloadActivity`'s `ORIGINAL` format.
 */
export async function downloadHealthSnapshot(
  host: ActivitiesHost,
  requestedDate: string | Date,
): Promise<Buffer> {
  const date = formatDate(requestedDate);
  return host.client.download(`/download-service/files/wellness/${pathSegment(date)}`);
}

/**
 * Upstream `get_personal_record`. No inventory task ever ported this row — discovered missing by
 * `tests/parity.test.ts` during Task 15's reconciliation pass and closed here rather than left
 * failing, since it is a simple unauthenticated-by-args GET with a direct precedent
 * (`getActivity`'s date-scoped sibling methods already key off `displayName()`). `null_behaviour`:
 * passes through unchecked, per the inventory.
 */
export async function getPersonalRecord(host: ActivitiesHost): Promise<PersonalRecords | null> {
  const displayName = await host.displayName();
  return host.client.connectapi<PersonalRecords>(
    `/personalrecord-service/personalrecord/prs/${pathSegment(displayName)}`,
  );
}

/**
 * Upstream validates `upload_activity` and `import_activity` against the same `ActivityUploadFormat`
 * enum, so this alias is not a placeholder for a future divergence — it exists to make the shared
 * constraint explicit at both call sites rather than having one method reach into a constant named
 * for the other.
 */
const UPLOAD_ACTIVITY_EXTENSIONS = IMPORT_ACTIVITY_EXTENSIONS;

/**
 * Upstream `upload_activity`. Like `get_personal_record`, no inventory task ever ported this row;
 * closed here during Task 15's reconciliation pass rather than left as a permanent parity-test
 * failure.
 *
 * **Distinct from `importActivity`**: this hits the PLAIN `/upload-service/upload` path with no
 * file-extension suffix and none of `importActivity`'s load-bearing `NK`/`origin`/custom
 * `User-Agent` headers — upstream's own `upload_activity` is the ordinary device-sync-shaped
 * upload, while `import_activity` (already ported) is the one that spoofs a different client to
 * make Garmin treat it as an import. Do not conflate the two; sending the import headers here (or
 * omitting them from `importActivity`) would swap their observed behaviour.
 *
 * Upstream's signature takes a filesystem path (`activity_path: str`) and reads the file itself.
 * This port follows the same Blob-based convention `importActivity` already established (this
 * library targets a server runtime, not a CLI with a trusted local filesystem convention) rather
 * than adding a second, inconsistent file-path-based entry point — a caller on Node can still
 * build a `Blob` from a file trivially (`new Blob([await readFile(path)])`).
 *
 * UNCERTAIN upstream null handling (upstream returns "Any (raw client response)" with no explicit
 * null-guard): implemented as a straightforward pass-through, matching this project's standing
 * rule for UNCERTAIN rows.
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
