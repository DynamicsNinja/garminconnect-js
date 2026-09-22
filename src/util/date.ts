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
