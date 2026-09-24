import { GarminError, GarminHttpError } from "../errors.js";
import type { GarminClient } from "../client.js";
import { formatDate } from "../util/date.js";
import { validateSportKey, validateUuid, pathSegment } from "../util/validate.js";
import type { Gear, GearDefaults, GearStats } from "../types/gear.js";

/**
 * This is the dedicated gear-CRUD service (`get_gear`, `create_gear`, `get_gear_stats`,
 * `get_gear_defaults`, `set_gear_default`). The activity/gear-*association* surface
 * (`getActivityGear`, `getGearActivities`, `addGearToActivity`, `removeGearFromActivity`) lives in
 * `src/services/activities.ts` instead — see that file's comments for why.
 */
export interface GearHost {
  readonly client: GarminClient;
}

/**
 * Upstream `get_gear`. Reuses the same base URL as `getActivityGear`
 * (`/gear-service/gear/filterGear`) with `userProfilePk` instead of `activityId` — see that
 * function's comment in `src/services/activities.ts`.
 *
 * Upstream's own docstring flags a possible deprecation: Garmin's web client calls
 * `/gear-service/gear/v2/list`, not this `filterGear` path. Live-verified in Task 7: `filterGear`
 * returns 200 with a JSON array (empty before any gear exists, non-empty once it does) — NOT
 * deprecated/broken. See the task-7 report for the full evidence.
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
 * Upstream `create_gear`. **Conversions happen here and must be replicated exactly** — the
 * OPPOSITE direction from `addWeighIn`'s "send the raw value" rule: `maxUsageDistanceKm` is
 * converted km -> metres (`round(km * 1000)`, must floor to >= 1), and `maxUsageDurationMin` is
 * converted min -> seconds (`round(min * 60)`, must floor to >= 1). Both floors throw
 * `GarminError` (mirroring upstream's `ValueError`) rather than silently sending 0.
 *
 * **BOTH conversions are live-verified**, by create -> read-back round-trip. Distance: 5 km sent
 * read back as `getGear`'s `maximumMeters: 5000`. Duration: 90 min sent read back as
 * `maxUsageDurationSeconds: 5400` from `/gear-service/gear/v2/{uuid}` — a record no earlier read
 * surfaced, which is why this note used to say the duration direction was unverifiable. Neither
 * rests on source review alone any more.
 *
 * `gearType`/`usageType` are normalized upper-case via `validateSportKey`, matching upstream's
 * `_validate_sport_key`. `usageType` must be one of `NONE`/`DISTANCE`/`DURATION`/`DATE`, read
 * live from `/gear-service/gear/v2/usagetypes` — these were once "unverified guesses" here and
 * are not any more. Note `"TIME"` is NOT valid (400 `Invalid value 'TIME' for usageType`); the
 * duration option is spelled `DURATION`.
 *
 * `activityTypeKeys` entries are sent lower-case (matching `getActivities`' `activitytype`
 * convention), which is the opposite case convention from upstream's `set_gear_default` —
 * a subtle asymmetry inherited from upstream. That method is not ported here (its endpoint is
 * dead); `setGearActivityDefaults` replaces it and also takes lowercase keys.
 *
 * `firstUseDate` is routed through `formatDate` per this project's date-argument rule, even
 * though it is a body field rather than a path/query segment.
 *
 * UNCERTAIN (inventory): "no explicit null handling" on the response — implemented as a
 * straightforward pass-through of the raw response. What would resolve it: a live account where
 * `create_gear` was observed returning something other than the created gear object.
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
 * Upstream `get_gear_stats`. On a 404, returns `{}` rather than throwing (matching upstream
 * exactly); any other error is re-raised as-is. `gearUUID` is validated via `validateUuid`
 * (hex characters, hyphens optional), matching upstream's `_validate_uuid`.
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
 * Upstream `get_gear_defaults`. `null_behaviour`: passes through unchecked (no throw, no
 * coalescing) — the payload is an array of `{uuid, activityTypePk, defaultGear}`-shaped entries
 * (live-verified in Task 7, see `GearDefaults` in `src/types/gear.ts`), not a single object.
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
 * **NOT a port of upstream python-garminconnect** — upstream has no delete-gear method, which is
 * why this project spent its entire build documenting gear fixtures as permanent residue. The
 * endpoint was found on 2026-09-23 by watching Garmin's own web client delete a gear item
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
 * Sets which activity types this gear is the default for — the **replacement for upstream's
 * `set_gear_default`**, whose endpoint is dead and which this port removed on 2026-09-24.
 *
 * **NOT upstream parity.** Upstream's
 * `PUT /gear-service/gear/{uuid}/activityType/{TYPE}/default/true` 404s on every activityType
 * spelling, against fresh gear and real gear alike — four investigations failed to make it work,
 * the last decisively: gear created WITH `activityTypeKeys`, linked to an activity, and defaulted
 * through THIS function, all succeeded against the same UUID seconds before that endpoint again
 * reported "gear not found". Watching Garmin's own client save the "Activities for This Gear" field showed why: the
 * modern mechanism is not a dedicated endpoint at all, but a full-record
 * `PUT /gear-service/gear/v2/{uuid}` carrying `associatedActivityTypes` — the same array shape
 * `createGear` already posts.
 *
 * `activityTypeKeys` are LOWERCASE (`"running"`, `"cycling"`), matching `createGear`'s convention —
 * NOT the upper-cased form upstream's `set_gear_default` sent through `validateSportKey`. That
 * asymmetry is upstream's, and it is one plausible reason the old endpoint never matched.
 *
 * READ-MODIFY-WRITE: this GETs the current gear record, swaps `associatedActivityTypes` wholesale,
 * and PUTs the whole record back. Two concurrent callers can clobber each other, and any field
 * Garmin adds to the record travels along untouched. Passing `[]` clears all defaults.
 *
 * Verified live 2026-09-23: setting `["running", "cycling"]` was read back from both
 * `/gear-service/gear/v2/{uuid}` and this port's own `getGearDefaults` (which reported
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
