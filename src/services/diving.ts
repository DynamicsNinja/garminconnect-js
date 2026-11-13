import type { GarminClient } from "../client.js";
import type { QueryParams } from "../http/fetcher.js";
import { GarminError } from "../errors.js";
import { formatDate } from "../util/date.js";
import { pathSegment } from "../util/validate.js";
import type {
  DiveLog, DiveLogPage, DiveLogFilters, DiveGear, DiveGearSummary,
  DiveGearFilters, DiverPrivacy,
} from "../types/diving.js";

export interface DivingHost {
  readonly client: GarminClient;
}

export function getDiveLogs(host: DivingHost, filters: DiveLogFilters = {}): Promise<DiveLogPage | null> {
  const { filter, dlnEligible, ...rest } = filters;
  for (const [key, value] of Object.entries({ requestedPage: filters.requestedPage, resultsPerPage: filters.resultsPerPage })) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || (key === "resultsPerPage" && value === 0))) {
      throw new GarminError(`Invalid ${key}`);
    }
  }
  return host.client.connectapi("/diving/v1/dive/summary", {
    params: { ...filter, ...rest, dlnEligible: dlnEligible === undefined ? undefined : String(dlnEligible) },
  });
}

export function getDiveLog(host: DivingHost, diveActivityId: string | number): Promise<DiveLog | null> {
  return host.client.connectapi(`/diving/v1/dive/detail/${id(diveActivityId)}`);
}

export function getDiveLogByConnectActivityId(host: DivingHost, connectActivityId: string | number): Promise<DiveLog | null> {
  return host.client.connectapi(`/diving/v1/dive/detail/by/connectid/${id(connectActivityId)}`);
}

export function getDiveTags(host: DivingHost): Promise<Record<string, number> | null> {
  return host.client.connectapi("/diving/v1/dive/tags");
}

export function getCurrentMaxDiveNumber(host: DivingHost): Promise<number | null> {
  return host.client.connectapi("/userprofile-service/userprofile/currentMaxDiveNumber");
}

export function getDiverCertifications(host: DivingHost): Promise<DiveGear[] | null> {
  return host.client.connectapi("/diving/v1/gear/certifications");
}

export async function getDiverCertification(host: DivingHost, gearId: string | number, currentUserDate: string): Promise<DiveGear | null> {
  const gear = await getDiveGear(host, gearId, currentUserDate);
  if (gear && gear.type !== "CERTIFICATION") throw new GarminError("Dive gear is not a certification");
  return gear;
}

export function getDiveGearSummaries(host: DivingHost, filters: DiveGearFilters = {}): Promise<DiveGearSummary[] | null> {
  return host.client.connectapi("/diving/v1/gear/summary", { params: {
    ...filters.filter, "gear-types": filters.gearTypes, "gear-status": filters.gearStatus,
    "current-user-date": filters.currentUserDate === undefined ? undefined : formatDate(filters.currentUserDate),
  } });
}

export function getDiveGear(host: DivingHost, gearId: string | number, currentUserDate: string): Promise<DiveGear | null> {
  return host.client.connectapi(`/diving/v1/gear/${id(gearId)}`, { params: dateParams(currentUserDate) });
}

export function getDiverPrivacy(host: DivingHost): Promise<DiverPrivacy | null> {
  return host.client.connectapi("/diving/v1/player/privacy");
}

function dateParams(date: string): QueryParams { return { "current-user-date": formatDate(date) }; }
function id(value: string | number): string {
  if ((typeof value === "number" && !Number.isSafeInteger(value)) || !/^[0-9]+$/.test(String(value))) {
    throw new GarminError("Dive identifiers must be numeric IDs, not Connect gear UUIDs or paths");
  }
  return pathSegment(value);
}
