import type { GarminClient } from "../client.js";
import { GarminError } from "../errors.js";
import { formatDate } from "../util/date.js";
import { pathSegment, validatePositiveInteger } from "../util/validate.js";
import type {
  Dog, DogBreed, DogInput, DogStats, DogStatsMetric, DogStatus, DogUpdate,
} from "../types/dogs.js";

/**
 * Dogs: profiles (Settings > Dogs in Garmin Connect), their activity stats, and which dogs joined
 * an activity. Captured from Garmin Connect's web client on 2026-11-24 and verified on the test
 * account; attaching a dog to an activity, which only the mobile app offers, was read back from an
 * activity edited in the app and then replayed here.
 *
 * The profiles live on a DIFFERENT HOST: `gcx.garmin.com/family-api/profile-service/...`, which
 * takes the usual OAuth2 bearer token. The same path on `connectapi` is a 404. The stats and the
 * activity link are on `connectapi` as usual.
 */
export interface DogsHost {
  readonly client: GarminClient;
}

const PETS = "/family-api/profile-service/profile/pets";
const STATS = "/fitnessstats-service/activity-animal/dog/stats";
const GCX = { host: "gcx" } as const;

const DOG_STATUSES: readonly DogStatus[] = ["active", "retired"];
const GENDERS = ["female", "male"];
const STATS_METRICS: readonly DogStatsMetric[] = ["distance", "duration"];

/** Every dog on the account; `status` narrows to active or retired ones. */
export async function getDogs(host: DogsHost, status?: DogStatus): Promise<Dog[]> {
  if (status !== undefined && !DOG_STATUSES.includes(status)) {
    throw new GarminError(`getDogs: status must be "active" or "retired", got "${String(status)}"`);
  }
  const dogs = await host.client.connectapi<Dog[]>(PETS, { ...GCX, params: { status } });
  return Array.isArray(dogs) ? dogs : [];
}

/** One dog by id. A missing id is a 404 `GarminHttpError` ("pet profile not found with id: …"). */
export async function getDog(host: DogsHost, dogId: number | string): Promise<Dog | null> {
  return host.client.connectapi<Dog>(`${PETS}/${dogPath(dogId)}`, GCX);
}

/**
 * Garmin's breed list, as `[{ id, key }]` sorted by id. Garmin answers `{ "1": "DOG_BREED_OTHER", … }`;
 * the key is a translation key, readable once `DOG_BREED_` is dropped and underscores are spaces.
 */
export async function getDogBreeds(host: DogsHost): Promise<DogBreed[]> {
  const map = await host.client.connectapi<Record<string, string>>(`${PETS}/dog/breeds`, GCX);
  if (!map || typeof map !== "object") return [];
  return Object.entries(map)
    .map(([id, key]) => ({ id: Number(id), key }))
    .sort((a, b) => a.id - b.id);
}

/** Creates a dog. Garmin caps an account at 10 active dogs. */
export async function createDog(host: DogsHost, input: DogInput): Promise<Dog | null> {
  if (!input || typeof input !== "object") throw new GarminError("createDog: input is required");
  return host.client.connectapi<Dog>(PETS, { ...GCX, method: "POST", json: dogBody(input, true) });
}

/**
 * Changes a dog. Garmin MERGES the PUT: fields left out keep their value, `null` clears one
 * (verified). A retired dog cannot be edited in Garmin's apps; unretire it first.
 */
export async function updateDog(host: DogsHost, dogId: number | string, changes: DogUpdate): Promise<Dog | null> {
  if (!changes || typeof changes !== "object" || Object.keys(changes).length === 0) {
    throw new GarminError("updateDog: give at least one field to change");
  }
  return host.client.connectapi<Dog>(`${PETS}/${dogPath(dogId)}`, {
    ...GCX, method: "PUT", json: dogBody(changes, false),
  });
}

/** Retires (`true`) or unretires (`false`) a dog: `PUT …/pets/{id}/status`, 204. */
export async function setDogRetired(host: DogsHost, dogId: number | string, retired: boolean): Promise<unknown> {
  if (typeof retired !== "boolean") throw new GarminError("setDogRetired: retired must be true or false");
  return host.client.connectapi(`${PETS}/${dogPath(dogId)}/status`, {
    ...GCX, method: "PUT", json: { status: retired ? "retired" : "active" },
  });
}

/**
 * Deletes a dog, 204. IRREVERSIBLE. Activities it joined KEEP its id in
 * `metadataDTO.dogProfileIds` (verified), so clear them with `setActivityDogs` first if that matters.
 */
export async function deleteDog(host: DogsHost, dogId: number | string): Promise<unknown> {
  return host.client.connectapi(`${PETS}/${dogPath(dogId)}`, { ...GCX, method: "DELETE" });
}

/**
 * Totals across every activity with any dog, plus one row per dog. Garmin 400s with no metric, so
 * the default is both. Distance in CENTIMETERS, duration in MILLISECONDS.
 */
export async function getDogLifetimeStats(
  host: DogsHost,
  metrics: DogStatsMetric[] = ["distance", "duration"],
): Promise<DogStats | null> {
  if (!Array.isArray(metrics) || metrics.length === 0 || metrics.some((m) => !STATS_METRICS.includes(m))) {
    throw new GarminError('getDogLifetimeStats: metrics must be a non-empty list of "distance"/"duration"');
  }
  return host.client.connectapi<DogStats>(`${STATS}/lifetime`, { params: { metric: [...new Set(metrics)] } });
}

/**
 * Per-dog stats for the given dogs, over a date range (by activity start date) or all time. The
 * figures sit on each `animalProfileGroups` entry. A POST that only reads. Give both dates or
 * neither: Garmin returned nothing at all for a start date alone.
 */
export async function getDogStats(
  host: DogsHost,
  dogIds: number[],
  startdate?: string | Date,
  enddate?: string | Date,
): Promise<DogStats[] | null> {
  const ids = dogIdList(dogIds, "getDogStats");
  if (ids.length === 0) throw new GarminError("getDogStats: give at least one dog id");
  if ((startdate === undefined) !== (enddate === undefined)) {
    throw new GarminError("getDogStats: give both startdate and enddate, or neither");
  }
  const start = startdate === undefined ? undefined : formatDate(startdate);
  const end = enddate === undefined ? undefined : formatDate(enddate);
  if (start && end && start > end) throw new GarminError("getDogStats: startdate must not be after enddate");
  return host.client.connectapi<DogStats[]>(`${STATS}/bulk`, {
    method: "POST", json: ids, params: { startDate: start, endDate: end },
  });
}

/**
 * Sets which dogs joined an activity, as the mobile app's "Include dog" does: a partial
 * `PUT /activity-service/activity/{id}` of `metadataDTO`. `[]` removes every dog.
 *
 * Garmin needs `hasDog: true` WITH the ids (ids alone are ignored) and stores ANY id it is sent,
 * even one that is no dog of this account. So the ids are checked against the account's ACTIVE
 * dogs first (one extra request), matching Garmin's apps, which do not offer retired dogs.
 */
export async function setActivityDogs(
  host: DogsHost,
  activityId: number | string,
  dogIds: number[],
): Promise<unknown> {
  const ids = dogIdList(dogIds, "setActivityDogs");
  const id = pathSegment(activityId);
  if (ids.length > 0) {
    const active = new Set((await getDogs(host, "active")).map((d) => d.id));
    const unknown = ids.filter((d) => !active.has(d));
    if (unknown.length > 0) {
      throw new GarminError(
        `setActivityDogs: ${unknown.join(", ")} is not an active dog on this account ` +
          "(see getDogs; a retired dog must be unretired with setDogRetired first)",
      );
    }
  }
  const metadataDTO = ids.length > 0 ? { hasDog: true, dogProfileIds: ids } : { hasDog: false };
  return host.client.connectapi(`/activity-service/activity/${id}`, {
    method: "PUT", json: { activityId, metadataDTO },
  });
}

function dogPath(dogId: number | string): string {
  const n = typeof dogId === "string" && /^[0-9]+$/.test(dogId) ? Number(dogId) : dogId;
  if (typeof n !== "number") throw new GarminError(`Dog ids are numeric, got "${String(dogId)}"`);
  return pathSegment(validatePositiveInteger(n, "dogId"));
}

function dogIdList(dogIds: number[], method: string): number[] {
  if (!Array.isArray(dogIds)) throw new GarminError(`${method}: dogIds must be an array of dog ids`);
  for (const d of dogIds) {
    if (!Number.isSafeInteger(d) || d <= 0) throw new GarminError(`${method}: invalid dog id ${String(d)}`);
  }
  return [...new Set(dogIds)];
}

/** `"YYYY-MM"` -> month precision, `"YYYY-MM-DD"` -> day precision, as Garmin stores them. */
function dogDate(value: string, field: string): { date: string; precision: "day" | "month" } {
  if (typeof value === "string" && /^\d{4}-\d{2}$/.test(value)) {
    return { date: formatDate(`${value}-01`), precision: "month" };
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { date: formatDate(value), precision: "day" };
  }
  throw new GarminError(`${field} must be "YYYY-MM" or "YYYY-MM-DD", got "${String(value)}"`);
}

/** Builds Garmin's body from the library's input, validating what Garmin itself does not. */
function dogBody(input: DogUpdate, creating: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const has = (k: keyof DogUpdate): boolean => Object.hasOwn(input, k) && input[k] !== undefined;
  const known = new Set([
    "name", "nickname", "primaryBreedId", "secondaryBreedIds", "gender", "isNeutered", "weightKg",
    "birthdate", "adoptionDate",
  ]);
  for (const k of Object.keys(input)) {
    if (!known.has(k)) {
      throw new GarminError(
        `Unknown dog field "${k}"` + (k === "weight" ? '; use "weightKg" (Garmin stores grams)' : ""),
      );
    }
  }
  if (creating || has("name")) {
    if (typeof input.name !== "string" || input.name.trim() === "") {
      throw new GarminError("A dog needs a non-blank name");
    }
    body["name"] = input.name;
  }
  if (has("nickname")) body["nickname"] = input.nickname;
  if (has("primaryBreedId")) {
    const b = input.primaryBreedId;
    if (b !== null && (!Number.isSafeInteger(b) || (b as number) <= 0)) throw new GarminError("primaryBreedId must be a breed id");
    body["primaryBreedId"] = b;
  }
  if (has("secondaryBreedIds")) {
    const list = input.secondaryBreedIds;
    if (!Array.isArray(list) || list.some((b) => !Number.isSafeInteger(b) || b <= 0)) {
      throw new GarminError("secondaryBreedIds must be an array of breed ids ([] clears them)");
    }
    body["secondaryBreedIds"] = list;
  }
  if (has("gender")) {
    if (input.gender !== null && !GENDERS.includes(input.gender as string)) {
      throw new GarminError(`gender must be "female" or "male" (or null), got "${String(input.gender)}"`);
    }
    body["gender"] = input.gender;
  }
  if (has("isNeutered")) {
    if (input.isNeutered !== null && typeof input.isNeutered !== "boolean") throw new GarminError("isNeutered must be a boolean or null");
    body["isNeutered"] = input.isNeutered;
  }
  if (has("weightKg")) {
    const kg = input.weightKg;
    if (kg !== null && (typeof kg !== "number" || !Number.isFinite(kg) || kg <= 0)) {
      throw new GarminError("weightKg must be a positive number (or null)");
    }
    body["weight"] = kg === null ? null : Math.round(kg * 1000);
  }
  for (const [field, dateKey, precisionKey] of [
    ["birthdate", "birthdate", "birthdatePrecision"],
    ["adoptionDate", "adoptionDate", "adoptionDatePrecision"],
  ] as const) {
    if (!has(field)) continue;
    const v = input[field];
    if (v === null) {
      body[dateKey] = null;
      body[precisionKey] = null;
    } else {
      const { date, precision } = dogDate(v as string, field);
      body[dateKey] = date;
      body[precisionKey] = precision;
    }
  }
  return body;
}
