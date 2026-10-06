import { GarminError, GarminHttpError } from "../errors.js";
import type { GarminClient } from "../client.js";
import { formatDate } from "../util/date.js";
import { validateSportKey, validateUuid, pathSegment } from "../util/validate.js";
import type { Gear, GearDefaults, GearStats } from "../types/gear.js";

/**
 * This is the dedicated gear-CRUD service (`getGear`, `createGear`, `getGearStats`,
 * `getGearDefaults`, `deleteGear`, `setGearActivityDefaults`). The activity/gear-*association* surface
 * (`getActivityGear`, `getGearActivities`, `addGearToActivity`, `removeGearFromActivity`) lives in
 * `src/services/activities.ts` instead — see that file's comments for why.
 */
export interface GearHost {
  readonly client: GarminClient;
}

/**
 * Reuses the same base URL as `getActivityGear` (`/gear-service/gear/filterGear`) with
 * `userProfilePk` instead of `activityId` — see that function's comment in
 * `src/services/activities.ts`.
 *
 * Garmin's web client calls `/gear-service/gear/v2/list`, not this `filterGear` path, which raised
 * a possible-deprecation concern. Live-verified: `filterGear` returns 200 with a JSON array (empty
 * before any gear exists, non-empty once it does) — NOT deprecated/broken.
 *
 * `null_behaviour`: passes through unchecked (no throw, no coalescing) — but the payload IS an
 * array of gear entries, not a single object; `Gear` (see `src/types/gear.ts`) types one entry.
 */
export async function getGear(
  host: GearHost,
  userProfileNumber: number | string,
): Promise<Gear[] | null> {
  return host.client.connectapi<Gear[]>("/gear-service/gear/filterGear", {
    params: { userProfilePk: userProfileNumber },
  });
}

function convertMaxUsageDistanceKm(km: number): number {
  const meters = Math.round(km * 1000);
  if (meters < 1) {
    throw new GarminError(
      `max_usage_distance_km must convert to at least 1 meter, got ${meters}m from ${km}km`,
    );
  }
  return meters;
}

function convertMaxUsageDurationMin(min: number): number {
  const seconds = Math.round(min * 60);
  if (seconds < 1) {
    throw new GarminError(
      `max_usage_duration_min must convert to at least 1 second, got ${seconds}s from ${min}min`,
    );
  }
  return seconds;
}

/**
 * **Conversions happen here and must be kept exactly** — the
 * OPPOSITE direction from `addWeighIn`'s "send the raw value" rule: `maxUsageDistanceKm` is
 * converted km -> metres (`round(km * 1000)`, must floor to >= 1), and `maxUsageDurationMin` is
 * converted min -> seconds (`round(min * 60)`, must floor to >= 1). Both floors throw
 * `GarminError` rather than silently sending 0.
 *
 * **BOTH conversions are live-verified**, by create -> read-back round-trip. Distance: 5 km sent
 * read back as `getGear`'s `maximumMeters: 5000`. Duration: 90 min sent read back as
 * `maxUsageDurationSeconds: 5400` from `/gear-service/gear/v2/{uuid}` — a record no earlier read
 * surfaced, which is why this note used to say the duration direction was unverifiable. Neither
 * rests on source review alone any more.
 *
 * `gearType`/`usageType` are normalized upper-case via `validateSportKey`. `usageType` must be one of `NONE`/`DISTANCE`/`DURATION`/`DATE`, read
 * live from `/gear-service/gear/v2/usagetypes` — these were once "unverified guesses" here and
 * are not any more. Note `"TIME"` is NOT valid (400 `Invalid value 'TIME' for usageType`); the
 * duration option is spelled `DURATION`.
 *
 * `activityTypeKeys` entries are sent lower-case (matching `getActivities`' `activitytype`
 * convention); `setGearActivityDefaults` takes lowercase keys too.
 *
 * `firstUseDate` is routed through `formatDate` per this project's date-argument rule, even
 * though it is a body field rather than a path/query segment.
 *
 * Returns Garmin's raw response.
 */
export async function createGear(
  host: GearHost,
  gearType: string,
  brand: string,
  model: string,
  name: string,
  firstUseDate: string | Date,
  usageType = "DISTANCE",
  maxUsageDistanceKm?: number,
  maxUsageDurationMin?: number,
  notes = "",
  activityTypeKeys?: string[],
): Promise<unknown> {
  const body: Record<string, unknown> = {
    uuid: null,
    gearType: validateSportKey(gearType),
    brand,
    model,
    name,
    firstUseDate: formatDate(firstUseDate),
    maxUsageDate: null,
    usageType: validateSportKey(usageType),
    notes,
    associatedActivityTypes: (activityTypeKeys ?? []).map((activityTypeKey) => ({
      activityTypeKey,
      defaultGear: true,
      preferredGear: false,
    })),
  };
  if (maxUsageDistanceKm !== undefined) {
    body["maxUsageDistanceMeters"] = convertMaxUsageDistanceKm(maxUsageDistanceKm);
  }
  if (maxUsageDurationMin !== undefined) {
    body["maxUsageDurationSeconds"] = convertMaxUsageDurationMin(maxUsageDurationMin);
  }
  return host.client.connectapi("/gear-service/gear/v2", { method: "POST", json: body });
}

/**
 * On a 404, returns `{}` rather than throwing; any other error is re-raised as-is. `gearUUID` is
 * validated via `validateUuid` (hex characters, hyphens optional).
 */
export async function getGearStats(host: GearHost, gearUUID: string): Promise<GearStats> {
  const uuid = validateUuid(gearUUID);
  try {
    const data = await host.client.connectapi<GearStats>(`/gear-service/gear/stats/${pathSegment(uuid)}`);
    return data ?? {};
  } catch (cause) {
    if (cause instanceof GarminHttpError && cause.status === 404) {
      return {};
    }
    throw cause;
  }
}

/**
 * Passes Garmin's response through unchecked (no throw, no coalescing) — the payload is an array
 * of `{uuid, activityTypePk, defaultGear}`-shaped entries (live-verified, see `GearDefaults` in `src/types/gear.ts`), not a single object.
 */
export async function getGearDefaults(
  host: GearHost,
  userProfileNumber: number | string,
): Promise<GearDefaults[] | null> {
  return host.client.connectapi<GearDefaults[]>(
    `/gear-service/gear/user/${pathSegment(userProfileNumber)}/activityTypes`,
  );
}

/**
 * `DELETE /gear-service/gear/v2/{gearUUID}` — permanently removes a gear item and its activity
 * history. Resolves to `null` on success (Garmin answers 204).
 *
 * The endpoint was found on 2026-09-23 by watching Garmin's own web client delete a gear item
 * (`connect.garmin.com/app/gear` -> gear detail -> ⋮ -> Delete), and then verified through this
 * client against the test account.
 *
 * **The UUID must be HYPHENATED.** This is the trap: `getGear` returns `uuid` WITHOUT hyphens
 * (`bf86b328b51f...`), and passing that form back here returns 404 — confirmed live, both ways.
 * `createGear`'s own response uses the hyphenated form. This function re-inserts the hyphens for
 * you when given the 32-character bare form, so either shape works; the 404 only bites callers who
 * hand-roll the URL.
 *
 * IRREVERSIBLE: Garmin's own confirmation dialog warns it "will permanently remove this gear and
 * its activity history". There is no undo.
 */
export async function deleteGear(host: GearHost, gearUUID: string): Promise<unknown> {
  const uuid = validateUuid(gearUUID);
  const bare = uuid.replace(/-/g, "");
  const hyphenated =
    bare.length === 32
      ? `${bare.slice(0, 8)}-${bare.slice(8, 12)}-${bare.slice(12, 16)}-${bare.slice(16, 20)}-${bare.slice(20)}`
      : uuid;
  return host.client.connectapi(`/gear-service/gear/v2/${pathSegment(hyphenated)}`, {
    method: "DELETE",
  });
}

/**
 * Sets which activity types this gear is the default for.
 *
 * The older dedicated endpoint,
 * `PUT /gear-service/gear/{uuid}/activityType/{TYPE}/default/true`, is dead: it 404s on every activityType
 * spelling, against fresh gear and real gear alike — four investigations failed to make it work,
 * the last decisively: gear created WITH `activityTypeKeys`, linked to an activity, and defaulted
 * through THIS function, all succeeded against the same UUID seconds before that endpoint again
 * reported "gear not found". Watching Garmin's own client save the "Activities for This Gear" field showed why: the
 * modern mechanism is not a dedicated endpoint at all, but a full-record
 * `PUT /gear-service/gear/v2/{uuid}` carrying `associatedActivityTypes` — the same array shape
 * `createGear` already posts.
 *
 * `activityTypeKeys` are LOWERCASE (`"running"`, `"cycling"`), matching `createGear`'s convention —
 * NOT upper-cased through `validateSportKey`.
 *
 * READ-MODIFY-WRITE: this GETs the current gear record, swaps `associatedActivityTypes` wholesale,
 * and PUTs the whole record back. Two concurrent callers can clobber each other, and any field
 * Garmin adds to the record travels along untouched. Passing `[]` clears all defaults.
 *
 * Verified live 2026-09-23: setting `["running", "cycling"]` was read back from both
 * `/gear-service/gear/v2/{uuid}` and `getGearDefaults` (which reported
 * `activityTypePk` 1 and 2).
 */
export async function setGearActivityDefaults(
  host: GearHost,
  gearUUID: string,
  activityTypeKeys: string[],
): Promise<unknown> {
  const uuid = validateUuid(gearUUID);
  const path = `/gear-service/gear/v2/${pathSegment(uuid)}`;
  const current = await host.client.connectapi<Record<string, unknown>>(path);
  if (!current) {
    throw new GarminError(`Cannot set gear defaults: no gear found for UUID ${gearUUID}`);
  }
  const body = {
    ...current,
    associatedActivityTypes: activityTypeKeys.map((activityTypeKey) => ({
      activityTypeKey,
      defaultGear: true,
      preferredGear: false,
    })),
  };
  return host.client.connectapi(path, { method: "PUT", json: body });
}
