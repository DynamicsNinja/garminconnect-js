/**
 * Response types for `src/services/womensHealth.ts`. Every read returns an object, passed through
 * unchecked, with no documented field shape. Honest index signatures only; do not invent fields.
 */

/** `GET /periodichealth-service/menstrualcycle/dayview/{fordate}`. */
export interface MenstrualDayView {
  [key: string]: unknown;
}

/** `GET /periodichealth-service/menstrualcycle/calendar/{startdate}/{enddate}`. */
export interface MenstrualCalendarData {
  [key: string]: unknown;
}

/** `GET /periodichealth-service/menstrualcycle/lastconfirmed/{fordate}`. */
export interface MenstrualLastConfirmed {
  [key: string]: unknown;
}

/** `GET /periodichealth-service/menstrualcycle/summary/{fordate}`. */
export interface MenstrualCycleSummary {
  [key: string]: unknown;
}

/** `GET /periodichealth-service/reports/menstrualcycle/{numberOfCycles}/{fordate}`. */
export interface MenstrualReports {
  [key: string]: unknown;
}

/** `GET /periodichealth-service/menstrualcycle/pregnancysnapshot`. */
export interface PregnancySummary {
  [key: string]: unknown;
}
