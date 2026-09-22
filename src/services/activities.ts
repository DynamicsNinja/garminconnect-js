import { GarminConnectionError, GarminError, GarminHttpError } from "../errors.js";
import type { GarminClient } from "../client.js";
import { formatDate } from "../util/date.js";
import type {
  Activity,
  ActivitiesForDateResponse,
  ActivityDownloadFormat,
  ActivityTypesResponse,
  ImportActivityResult,
} from "../types/activities.js";

export interface ActivitiesHost {
  readonly client: GarminClient;
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
    `/activity-service/activity/${activityId}`,
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
  return host.client.download(`${base}/${activityId}`);
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
    `/mobile-gateway/heartRate/forDate/${date}`,
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
  return host.client.connectapi(`/activity-service/activity/${activityId}`, {
    method: "DELETE",
  });
}

/** UNCERTAIN (inventory): "no explicit null handling, returns raw response". */
export async function setActivityName(
  host: ActivitiesHost,
  activityId: number | string,
  activityName: string,
): Promise<unknown> {
  return host.client.connectapi(`/activity-service/activity/${activityId}`, {
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
  return host.client.connectapi(`/activity-service/activity/${activityId}`, {
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
  return host.client.connectapi(`/activity-service/activity/${activityId}`, {
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
    const result = await host.client.upload(file, filename, `/upload-service/upload/${extension}`, {
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
