/**
 * Response types for `src/services/womensHealth.ts`. Every read row in the inventory's
 * `womensHealth` section is labelled `returns: dict, null_behaviour: passes through unchecked` with
 * no documented field shape — the test account used for live verification has no cycle-tracking
 * data, so no real payload has ever been observed to shape these against. Honest index signatures
 * only; do not invent fields.
 */

/** `GET /periodichealth-service/menstrualcycle/dayview/{fordate}` (`get_menstrual_data_for_date`). */
export interface MenstrualDayView {
  [key: string]: unknown;
}

/**
 * `GET /periodichealth-service/menstrualcycle/calendar/{startdate}/{enddate}`
 * (`get_menstrual_calendar_data`).
 */
export interface MenstrualCalendarData {
  [key: string]: unknown;
}

/** `GET /periodichealth-service/menstrualcycle/lastconfirmed/{fordate}` (`get_menstrual_last_confirmed`). */
export interface MenstrualLastConfirmed {
  [key: string]: unknown;
}

/** `GET /periodichealth-service/menstrualcycle/summary/{fordate}` (`get_menstrual_cycle_summary`). */
export interface MenstrualCycleSummary {
  [key: string]: unknown;
}

/**
 * `GET /periodichealth-service/reports/menstrualcycle/{number_of_cycles}/{fordate}`
 * (`get_menstrual_reports`).
 */
export interface MenstrualReports {
  [key: string]: unknown;
}

/** `GET /periodichealth-service/menstrualcycle/pregnancysnapshot` (`get_pregnancy_summary`). */
export interface PregnancySummary {
  [key: string]: unknown;
}
