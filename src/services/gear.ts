import { GarminConnectionError, GarminError, GarminHttpError } from "../errors.js";
import type { GarminClient } from "../client.js";
import { formatDate } from "../util/date.js";
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

const SPORT_KEY_RE = /^[A-Z_]+$/;

/** Mirrors upstream `_validate_sport_key`: upper-cased, must match `^[A-Z_]+$`. Duplicated from
 * `src/services/metrics.ts` (not exported there) rather than introducing a cross-service import. */
function validateSportKey(key: string): string {
  const normalized = key.toUpperCase();
  if (!SPORT_KEY_RE.test(normalized)) {
    throw new GarminError(`Invalid sport/gear-type key: "${key}"`);
  }
  return normalized;
}

const UUID_HEX_RE = /^[0-9a-fA-F]+$/;

/** Mirrors upstream `_validate_uuid`: hex characters, hyphens optional (stripped before checking). */
function validateUuid(uuid: string): string {
  const stripped = uuid.replace(/-/g, "");
  if (stripped.length === 0 || !UUID_HEX_RE.test(stripped)) {
    throw new GarminError(`Invalid gear UUID: "${uuid}"`);
  }
  return uuid;
}

/**
 * Upstream `get_gear`. Reuses the same base URL as `getActivityGear`
 * (`/gear-service/gear/filterGear`) with `userProfilePk` instead of `activityId` — see that
 * function's comment in `src/services/activities.ts`.
 *
 * Upstream's own docstring flags a possible deprecation: Garmin's web client calls
 * `/gear-service/gear/v2/list`, not this `filterGear` path — see the task report for the live
 * verdict on whether `filterGear` still works.
 *
 * `null_behaviour`: passes through unchecked (no throw, no coalescing).
 */
export async function getGear(
  host: GearHost,
  userProfileNumber: number | string,
): Promise<Gear | null> {
  return host.client.connectapi<Gear>("/gear-service/gear/filterGear", {
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
 * `gearType`/`usageType` are normalized upper-case via `validateSportKey`, matching upstream's
 * `_validate_sport_key`. Only `gearType="SHOES"` / `usageType="DISTANCE"` are confirmed against a
 * real account per upstream's docstring; other values are unverified guesses at Garmin's
 * SCREAMING_SNAKE_CASE convention.
 *
 * `activityTypeKeys` entries are sent lower-case (matching `getActivities`' `activitytype`
 * convention), which is the opposite case convention from `setGearDefault`'s `activityType` —
 * a subtle asymmetry inherited from upstream, not a bug here.
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
    const data = await host.client.connectapi<GearStats>(`/gear-service/gear/stats/${uuid}`);
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
 * coalescing).
 */
export async function getGearDefaults(
  host: GearHost,
  userProfileNumber: number | string,
): Promise<GearDefaults | null> {
  return host.client.connectapi<GearDefaults>(
    `/gear-service/gear/user/${userProfileNumber}/activityTypes`,
  );
}

/**
 * Upstream `set_gear_default`. The HTTP verb is chosen dynamically by `defaultGear`: `true` PUTs
 * `.../default/true`, `false` DELETEs the plain activityType path — this is NOT a fixed verb.
 * `activityType` is normalized upper-case via `validateSportKey` — the opposite case convention
 * from `createGear`'s lower-case `activityTypeKeys`, matching upstream's own asymmetry. On a 404,
 * re-raised as `GarminConnectionError` with a "gear not found (likely retired/removed)" message,
 * matching the same pattern as `addGearToActivity`/`removeGearFromActivity` in
 * `src/services/activities.ts`; other errors are re-raised as-is.
 */
export async function setGearDefault(
  host: GearHost,
  activityType: string,
  gearUUID: string,
  defaultGear = true,
): Promise<unknown> {
  const type = validateSportKey(activityType);
  const path = defaultGear
    ? `/gear-service/gear/${gearUUID}/activityType/${type}/default/true`
    : `/gear-service/gear/${gearUUID}/activityType/${type}`;
  try {
    return await host.client.connectapi(path, { method: defaultGear ? "PUT" : "DELETE" });
  } catch (cause) {
    if (cause instanceof GarminHttpError && cause.status === 404) {
      throw new GarminConnectionError(
        `Cannot set gear default for UUID ${gearUUID}: gear not found (likely retired/removed)`,
        { cause },
      );
    }
    throw cause;
  }
}
