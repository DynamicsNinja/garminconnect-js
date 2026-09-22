import { GarminError } from "../errors.js";
import type { GarminClient } from "../client.js";
import type { Activity, ActivityDownloadFormat } from "../types/activities.js";

export interface ActivitiesHost {
  readonly client: GarminClient;
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
