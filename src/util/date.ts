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

const HAS_TIME = /\d{2}:\d{2}/;
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Parse an ISO timestamp the way Python's `datetime.fromisoformat(s).astimezone()`
 * does for a NAIVE string: the wall clock is taken as LOCAL time.
 *
 * JavaScript's `new Date(s)` disagrees with that in two places, both handled
 * here: a date-only string (`"2026-09-20"`) is parsed as UTC midnight by spec,
 * and a bare date is not a datetime at all. A string carrying its own offset
 * or `Z` is passed through untouched — it already names an instant.
 */
export function parseIsoLocal(s: string): Date {
  return new Date(HAS_TIME.test(s) ? s : `${s}T00:00:00`);
}

/**
 * Parse an ISO timestamp the way upstream treats a supplied `gmtTimestamp`:
 * "assume provided GMT is UTC if naive". A naive string therefore gets `Z`
 * appended rather than being read as local time, which is what `new Date`
 * would otherwise do.
 */
export function parseIsoUtc(s: string): Date {
  if (HAS_ZONE.test(s)) return new Date(s);
  return new Date(`${HAS_TIME.test(s) ? s : `${s}T00:00:00`}Z`);
}
