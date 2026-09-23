import { GarminError } from "../errors.js";
import type { GarminClient } from "../client.js";
import {
  formatDate,
  formatGmtTimestamp,
  formatLocalTimestamp,
  parseIsoLocal,
  parseIsoUtc,
} from "../util/date.js";
import type { DailyWeighIns, WeighInRange } from "../types/weight.js";

export interface WeightHost {
  readonly client: GarminClient;
}

/**
 * NOTE the read/write asymmetry: Garmin's read side (here) always returns
 * weight in GRAMS regardless of the unit the entry was recorded in — dividing
 * by 1000 is correct. `addWeighIn` below sends the value in the CALLER'S unit
 * (kg or lbs) unconverted; Garmin converts server-side from `unitKey`. The
 * two are not symmetric — do not "fix" one to match the other.
 */
export async function getWeighIns(
  host: WeightHost,
  startdate: string | Date,
  enddate: string | Date,
): Promise<WeighInRange> {
  const start = formatDate(startdate);
  const end = formatDate(enddate);
  const data = await host.client.connectapi<WeighInRange>(
    `/weight-service/weight/range/${start}/${end}`,
    { params: { includeAll: "true" } },
  );
  return data ?? {};
}

/**
 * NOTE the read/write asymmetry: unlike `getWeighIns` above (which always
 * receives grams from Garmin), this sends `value` as the RAW number in the
 * unit named by `unitKey` — no grams conversion, no rounding. Garmin
 * converts server-side. Upstream python-garminconnect does exactly this
 * (`payload["value"] = weight`); sending a pre-converted gram figure
 * alongside `unitKey: "kg"` tells Garmin "this many kilograms" and inflates
 * the stored value by 1000x — confirmed against a live account.
 */
export async function addWeighIn(
  host: WeightHost,
  weight: number,
  unitKey: "kg" | "lbs" = "kg",
  when: Date = new Date(),
): Promise<unknown> {
  // `when` is captured once by the caller (defaulting to `new Date()` at the
  // call site) so both fields describe the same instant — computing it twice
  // here could straddle a millisecond and disagree by a second.
  return host.client.connectapi("/weight-service/user-weight", {
    method: "POST",
    json: {
      dateTimestamp: formatLocalTimestamp(when),
      gmtTimestamp: formatGmtTimestamp(when),
      unitKey,
      sourceType: "MANUAL",
      value: weight,
    },
  });
}

export async function deleteWeighIn(
  host: WeightHost,
  cdate: string | Date,
  weightPk: number,
): Promise<null> {
  await host.client.connectapi(
    `/weight-service/weight/${formatDate(cdate)}/byversion/${weightPk}`,
    { method: "DELETE" },
  );
  return null;
}

/**
 * Same raw-value, no-conversion rule as `addWeighIn` above — `weight` is
 * sent as-is in `value`, in whatever unit `unitKey` names. This method's
 * only difference from `addWeighIn` is that the caller supplies the local
 * and GMT timestamp strings directly (matching upstream's
 * `add_weigh_in_with_timestamps(weight, unitKey, dateTimestamp, gmtTimestamp)`)
 * instead of a single `Date` this library derives both from.
 *
 * The two timestamps are COUPLED, exactly as upstream couples them, and this
 * is the whole subtlety of the method. Upstream resolves the local instant
 * first — from `dateTimestamp` if given, otherwise from now — and then
 * derives GMT from THAT instant (`dtGMT = dt.astimezone(UTC)`) whenever
 * `gmtTimestamp` is omitted. Deriving the two independently looks equivalent
 * but is not: a caller backdating an entry with `dateTimestamp` alone would
 * get a `gmtTimestamp` pinned to the current moment, silently writing a
 * weigh-in whose two halves describe different days.
 *
 * Both supplied strings are re-formatted rather than forwarded verbatim,
 * again matching upstream, which parses each one and emits `_fmt_ts(...)`.
 * A naive `dateTimestamp` is read as LOCAL time and a naive `gmtTimestamp`
 * as UTC — see `parseIsoLocal`/`parseIsoUtc`.
 */
export async function addWeighInWithTimestamps(
  host: WeightHost,
  weight: number,
  unitKey: "kg" | "lbs" = "kg",
  dateTimestamp?: string,
  gmtTimestamp?: string,
  when: Date = new Date(),
): Promise<unknown> {
  const localInstant = dateTimestamp ? parseIsoLocal(dateTimestamp) : when;
  if (Number.isNaN(localInstant.getTime())) {
    throw new GarminError(`invalid dateTimestamp: "${dateTimestamp ?? ""}"`);
  }
  // NOT `when`: GMT falls out of whatever local instant was just resolved.
  const gmtInstant = gmtTimestamp ? parseIsoUtc(gmtTimestamp) : localInstant;
  if (Number.isNaN(gmtInstant.getTime())) {
    throw new GarminError(`invalid gmtTimestamp: "${gmtTimestamp ?? ""}"`);
  }

  return host.client.connectapi("/weight-service/user-weight", {
    method: "POST",
    json: {
      dateTimestamp: formatLocalTimestamp(localInstant),
      gmtTimestamp: formatGmtTimestamp(gmtInstant),
      unitKey,
      sourceType: "MANUAL",
      value: weight,
    },
  });
}

export async function getDailyWeighIns(
  host: WeightHost,
  cdate: string | Date,
): Promise<DailyWeighIns | null> {
  return host.client.connectapi<DailyWeighIns>(
    `/weight-service/weight/dayview/${formatDate(cdate)}`,
    { params: { includeAll: "true" } },
  );
}

/**
 * Multi-step, no HTTP path of its own — mirrors upstream's `delete_weigh_ins`:
 * fetches the day's weigh-ins via `getDailyWeighIns`, then:
 *  - if there are none, returns `null` (upstream logs a warning);
 *  - if there is more than one and `deleteAll` is not `true`, also returns
 *    `null` without deleting anything (upstream logs a warning instead of
 *    guessing which entry the caller meant);
 *  - otherwise deletes every entry on that date via `deleteWeighIn` and
 *    returns the count deleted.
 *
 * IRREVERSIBLE: every weigh-in recorded on `cdate` is gone once this
 * resolves. Never call this against a date you did not populate yourself.
 */
export async function deleteWeighIns(
  host: WeightHost,
  cdate: string | Date,
  deleteAll = false,
): Promise<number | null> {
  const date = formatDate(cdate);
  const day = await getDailyWeighIns(host, date);
  const entries = day?.dateWeightList ?? [];
  if (entries.length === 0) return null;
  if (entries.length > 1 && !deleteAll) return null;

  let deleted = 0;
  for (const entry of entries) {
    if (typeof entry.samplePk !== "number") continue;
    await deleteWeighIn(host, date, entry.samplePk);
    deleted++;
  }
  return deleted;
}
