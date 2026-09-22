import { GarminAuthError, GarminError } from "../errors.js";
import type { GarminClient } from "../client.js";
import { formatDate } from "../util/date.js";
import type {
  BodyBatteryEntry,
  HeartRateData,
  HrvData,
  SleepData,
  StepsEntry,
  UserSummary,
} from "../types/wellness.js";

/** Implemented against a host exposing `client` and `displayName()`. */
export interface WellnessHost {
  readonly client: GarminClient;
  displayName(): Promise<string>;
}

export async function getUserSummary(
  host: WellnessHost,
  cdate: string | Date,
): Promise<UserSummary> {
  const date = formatDate(cdate);
  const summary = await host.client.connectapi<UserSummary>(
    `/usersummary-service/usersummary/daily/${await host.displayName()}`,
    { params: { calendarDate: date } },
  );
  if (!summary) throw new GarminError("No user summary received from Garmin");
  if (summary.privacyProtected === true) {
    throw new GarminAuthError("User summary is privacy-protected");
  }
  return summary;
}

export async function getStepsData(
  host: WellnessHost,
  cdate: string | Date,
): Promise<StepsEntry[]> {
  const date = formatDate(cdate);
  const steps = await host.client.connectapi<StepsEntry[]>(
    `/wellness-service/wellness/dailySummaryChart/${await host.displayName()}`,
    { params: { date } },
  );
  return steps ?? [];
}

export async function getHeartRates(
  host: WellnessHost,
  cdate: string | Date,
): Promise<HeartRateData> {
  const date = formatDate(cdate);
  const data = await host.client.connectapi<HeartRateData>(
    `/wellness-service/wellness/dailyHeartRate/${await host.displayName()}`,
    { params: { date } },
  );
  if (!data) throw new GarminError("No heart rate data received from Garmin");
  return data;
}

export async function getSleepData(
  host: WellnessHost,
  cdate: string | Date,
): Promise<SleepData> {
  const date = formatDate(cdate);
  const data = await host.client.connectapi<SleepData>(
    `/wellness-service/wellness/dailySleepData/${await host.displayName()}`,
    { params: { date, nonSleepBufferMinutes: 60 } },
  );
  if (!data) throw new GarminError("No sleep data received from Garmin");
  return data;
}

export async function getHrvData(
  host: WellnessHost,
  cdate: string | Date,
): Promise<HrvData | null> {
  return host.client.connectapi<HrvData>(`/hrv-service/hrv/${formatDate(cdate)}`);
}

export async function getBodyBattery(
  host: WellnessHost,
  startdate: string | Date,
  enddate?: string | Date,
): Promise<BodyBatteryEntry[]> {
  const start = formatDate(startdate);
  const end = enddate === undefined ? start : formatDate(enddate);
  const data = await host.client.connectapi<BodyBatteryEntry[]>(
    "/wellness-service/wellness/bodyBattery/reports/daily",
    { params: { startDate: start, endDate: end } },
  );
  return data ?? [];
}
