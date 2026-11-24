/**
 * Dog profiles and the activity stats Garmin keeps for them. Field names and units observed on
 * 2026-11-24, on the test account and a real one, through the requests Garmin Connect's web client
 * sends (Settings > Dogs). Garmin serves the profiles from `gcx.garmin.com/family-api/...`, not
 * `connectapi`.
 */

/** A dog's status. A retired dog keeps its history but Garmin's apps stop offering it for new activities. */
export type DogStatus = "active" | "retired";

/** The two values Garmin's apps offer. Garmin itself stores any string sent, so this library refuses others. */
export type DogGender = "female" | "male";

/** How much of a stored date is meant: Garmin keeps `"2022-03-01"` + `"month"` for "March 2022". No `"year"`. */
export type DogDatePrecision = "day" | "month";

/** A breed as a dog profile carries it. `name` is upper-case with spaces, e.g. `"AIREDALE TERRIER"`. */
export interface DogBreedRef {
  id: number;
  name: string;
  species: string;
  [key: string]: unknown;
}

/** A breed from `getDogBreeds`: its id and Garmin's translation key, e.g. `"DOG_BREED_AIREDALE_TERRIER"`. */
export interface DogBreed {
  id: number;
  key: string;
}

/** A dog profile, as Garmin returns it. */
export interface Dog {
  id: number;
  /** The profile id of the account that owns the dog. */
  adminId: number;
  name: string;
  nickname: string | null;
  /** `"dog"`. */
  species: string;
  primaryBreed: DogBreedRef | null;
  secondaryBreeds: DogBreedRef[];
  gender: string | null;
  isNeutered: boolean | null;
  /** GRAMS (`21500` is 21.5 kg). */
  weight: number | null;
  /** `YYYY-MM-DD`; with `birthdatePrecision: "month"` only the year and month are meant. */
  birthdate: string | null;
  birthdatePrecision: DogDatePrecision | null;
  adoptionDate: string | null;
  adoptionDatePrecision: DogDatePrecision | null;
  status: DogStatus;
  /** Present on a retired dog: a local timestamp without zone. */
  retiredAt?: string;
  deviceId: unknown;
  [key: string]: unknown;
}

/**
 * A new dog. `weightKg` is converted to the grams Garmin stores. A date is `"YYYY-MM"` (month
 * precision, as the "Day is optional" form sends it) or `"YYYY-MM-DD"`; a year alone is not
 * something Garmin stores.
 */
export interface DogInput {
  name: string;
  nickname?: string | null;
  /** An id from `getDogBreeds`. */
  primaryBreedId?: number | null;
  /** Ids from `getDogBreeds`. */
  secondaryBreedIds?: number[];
  gender?: DogGender | null;
  /** Spayed or neutered ("Fixed" in Garmin's form). */
  isNeutered?: boolean | null;
  weightKg?: number | null;
  birthdate?: string | null;
  adoptionDate?: string | null;
}

/** Changes for `updateDog`: only the fields given change; `null` clears one. */
export type DogUpdate = Partial<Omit<DogInput, "name">> & { name?: string };

/** A metric `getDogLifetimeStats` can total. */
export type DogStatsMetric = "distance" | "duration";

/** Totals over a set of activities. Distance in CENTIMETERS, duration in MILLISECONDS. */
export interface DogStatsAggregate {
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  sum: number;
}

/** One dog's share of the activities. In `getDogStats` it also carries its own `distance`/`duration`. */
export interface DogActivityGroup {
  animalProfileId: number;
  numberOfActivities: number;
  /** ISO timestamp, UTC. */
  recentActivityStartTimeGmt: string;
  distance?: DogStatsAggregate;
  duration?: DogStatsAggregate;
  [key: string]: unknown;
}

/**
 * Dog activity stats. `getDogLifetimeStats` fills `all.distance`/`all.duration` across every dog
 * activity; `getDogStats` leaves them out and puts the figures on each `animalProfileGroups` entry.
 * Distance in CENTIMETERS, duration in MILLISECONDS (a 40 km activity reads `4000000`).
 */
export interface DogStats {
  /** The day the stats were computed, not a filter. */
  date: string;
  countOfActivities: number;
  stats: {
    all: {
      distance?: DogStatsAggregate;
      duration?: DogStatsAggregate;
      animals: { animalProfileGroups: DogActivityGroup[] };
    };
  };
  [key: string]: unknown;
}
