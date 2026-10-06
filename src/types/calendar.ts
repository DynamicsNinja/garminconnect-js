/**
 * A calendar event — a race or other dated event on the Garmin Connect calendar, as stored by
 * `calendar-service`. Shape read live on 2026-10-06 from events this library created and deleted.
 */
export interface CalendarEvent {
  id: number;
  eventName: string;
  /** `YYYY-MM-DD`. */
  date: string;
  url?: string | null;
  registrationUrl?: string | null;
  courseId?: number | null;
  /** The event's own distance, e.g. `{ value: 10, unit: "kilometer", unitType: "distance" }`. */
  completionTarget?: CalendarEventTarget | null;
  /** Start time. Garmin may rewrite `timeZoneId` to another zone with the same offset. */
  eventTimeLocal?: { startTimeHhMm: string; timeZoneId: string } | null;
  note?: string | null;
  workoutId?: number | null;
  location?: string | null;
  /** Sport key such as `"running"` or `"cycling"`. Garmin answers an unknown one with a 500. */
  eventType?: string | null;
  /** User-created events are always PRIVATE and never shareable, whatever is sent. */
  eventPrivacy?: { label: string; isShareable: boolean; isDiscoverable: boolean };
  /** Set only on events subscribed to from Garmin's events catalogue. */
  shareableEventUuid?: string | null;
  eventCustomization?: {
    /** Your goal for the event, e.g. `{ value: 2700, unit: "second", unitType: "time" }`. */
    customGoal?: CalendarEventTarget | null;
    isPrimaryEvent?: boolean;
    /** Garmin sets this to true whenever `isPrimaryEvent` is. */
    isTrainingEvent?: boolean;
    associatedWithActivityId?: number | null;
    isGoalMet?: boolean | null;
    trainingPlanId?: number | null;
    [key: string]: unknown;
  };
  race?: boolean;
  [key: string]: unknown;
}

/** A distance or time target, the way `calendar-service` stores both. */
export interface CalendarEventTarget {
  value: number;
  unit: string;
  unitType: string;
}

/** Distance units Garmin Connect's event editor offers. */
export type CalendarEventDistanceUnit = "meter" | "kilometer" | "yard" | "mile";

/** Input to `createCalendarEvent`. Only `name` and `date` are required. */
export interface CalendarEventInput {
  name: string;
  /** `YYYY-MM-DD` or a `Date` (formatted as a UTC calendar date). */
  date: string | Date;
  /** Start time as `"HH:MM"`. Needs `timeZoneId`. */
  startTime?: string;
  /** IANA zone, e.g. `"Europe/London"`. */
  timeZoneId?: string;
  /** Sport key such as `"running"` or `"cycling"`. */
  eventType?: string;
  /** Marks it as a race. */
  race?: boolean;
  /** Your primary event; Garmin then also marks it a training event. */
  primary?: boolean;
  distance?: { value: number; unit: CalendarEventDistanceUnit };
  /** Your goal time for the event, in seconds. */
  goalTimeSeconds?: number;
  location?: string;
  url?: string;
  note?: string;
}

/**
 * Changes for `updateCalendarEvent`. A field that is present replaces the stored value; `null`
 * clears an optional one.
 */
export interface CalendarEventUpdate {
  name?: string;
  date?: string | Date;
  location?: string | null;
  url?: string | null;
  note?: string | null;
  race?: boolean;
  goalTimeSeconds?: number | null;
}
