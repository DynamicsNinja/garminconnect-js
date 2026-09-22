import { GarminError } from "../errors.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalizes to the `YYYY-MM-DD` form Garmin expects.
 *
 * `Date` objects are formatted in UTC, not the local timezone. Garmin's API
 * consumes UTC calendar dates, so this is correct — but it is a foot-gun for
 * a caller in a negative UTC offset: passing `new Date()` late in their local
 * day can format as tomorrow's date, because it is already tomorrow in UTC.
 */
export function formatDate(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new GarminError("Expected a valid date");
    }
    return value.toISOString().slice(0, 10);
  }
  if (!ISO_DATE.test(value)) {
    throw new GarminError(`Expected a date in YYYY-MM-DD format, got "${value}"`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new GarminError(`Expected a valid date, got "${value}"`);
  }
  return value;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * Local wall-clock time formatted as Garmin's `*TimestampLocal`/`dateTimestamp`
 * write fields expect (`YYYY-MM-DDTHH:mm:ss.00`, no offset). Deliberately
 * built from the local getters (`getFullYear`/`getHours`/...), not
 * `toISOString()`, which is always UTC. Shared by every write endpoint that
 * pairs a local timestamp with a GMT one (`addWeighIn`, `setBloodPressure`,
 * `addHydrationData`, ...) — live-verified against real Garmin via
 * `addWeighIn` (the endpoint implicated in the historical "93,000 kg" bug),
 * so do not alter its output when reusing it.
 */
export function formatLocalTimestamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.00`
  );
}

/**
 * UTC instant formatted as Garmin's `*TimestampGMT`/`gmtTimestamp` write
 * fields expect. See `formatLocalTimestamp` above for the pairing and the
 * live-verification note.
 */
export function formatGmtTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19) + ".00";
}
