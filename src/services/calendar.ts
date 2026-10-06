import { GarminError } from "../errors.js";
import type { GarminClient } from "../client.js";
import { formatDate } from "../util/date.js";
import { pathSegment } from "../util/validate.js";
import type {
  CalendarEvent,
  CalendarEventDistanceUnit,
  CalendarEventInput,
  CalendarEventUpdate,
} from "../types/calendar.js";

/**
 * Calendar events — races and other dated events on the Garmin Connect calendar.
 *
 * Events can be read from the month calendar feed or `GET /calendar-service/event/{id}`; create,
 * list, update and delete were found by probing `calendar-service`. All of it was verified live on 2026-10-06 by a create -> read back -> list -> update -> read back ->
 * delete -> 404 round-trip on the test account (`npm run smoke:gaps`).
 *
 * Events also appear in `getScheduledWorkouts`' month feed as items with `itemType: "event"`.
 */
export interface CalendarHost {
  readonly client: GarminClient;
}

const DISTANCE_UNITS: ReadonlySet<string> = new Set<CalendarEventDistanceUnit>([
  "meter",
  "kilometer",
  "yard",
  "mile",
]);

function timeGoal(seconds: number): { value: number; unit: string; unitType: string } {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new GarminError(`goalTimeSeconds must be a positive number; got ${String(seconds)}`);
  }
  return { value: seconds, unit: "second", unitType: "time" };
}

/**
 * `GET /calendar-service/events`. With both dates, the events between them (inclusive); with
 * neither, every event on the account.
 */
export async function listCalendarEvents(
  host: CalendarHost,
  startdate?: string | Date,
  enddate?: string | Date,
): Promise<CalendarEvent[] | null> {
  if ((startdate === undefined) !== (enddate === undefined)) {
    throw new GarminError("listCalendarEvents takes both startdate and enddate, or neither");
  }
  const params =
    startdate !== undefined && enddate !== undefined
      ? { startDate: formatDate(startdate), endDate: formatDate(enddate) }
      : undefined;
  return host.client.connectapi<CalendarEvent[]>("/calendar-service/events", { params });
}

/** `GET /calendar-service/event/{eventId}`. A missing id is a 404 (`GarminHttpError`). */
export async function getCalendarEvent(
  host: CalendarHost,
  eventId: number | string,
): Promise<CalendarEvent | null> {
  return host.client.connectapi<CalendarEvent>(`/calendar-service/event/${pathSegment(eventId)}`);
}

/**
 * An event from Garmin's public events catalogue (Races & Events -> Find an Event), by its
 * `shareableEventUuid`: `GET /calendar-service/event/{uuid}/shareable`. Works WITHOUT subscribing
 * to the event (`subscribed: false` then) — verified live on 2026-10-06 against a catalogue 10K.
 * The plain `/calendar-service/event/{uuid}` is a 404; numeric ids go through `getCalendarEvent`.
 * Events you create yourself never get a shareable uuid.
 */
export async function getSharedCalendarEvent(
  host: CalendarHost,
  shareableEventUuid: string,
): Promise<CalendarEvent | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shareableEventUuid)) {
    throw new GarminError(`Invalid shareable event UUID: "${shareableEventUuid}"`);
  }
  return host.client.connectapi<CalendarEvent>(
    `/calendar-service/event/${pathSegment(shareableEventUuid)}/shareable`,
  );
}

/**
 * `POST /calendar-service/event`. Returns the stored event with its `id`.
 *
 * Garmin keeps every user-created event PRIVATE: a `PUBLIC` or shareable privacy in the body is
 * silently replaced, so this method does not offer one.
 */
export async function createCalendarEvent(
  host: CalendarHost,
  input: CalendarEventInput,
): Promise<CalendarEvent | null> {
  if (!input.name.trim()) throw new GarminError("createCalendarEvent requires a non-empty name");
  if ((input.startTime === undefined) !== (input.timeZoneId === undefined)) {
    throw new GarminError("startTime and timeZoneId go together: give both or neither");
  }
  if (input.startTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime)) {
    throw new GarminError(`startTime must be "HH:MM" (24-hour); got "${input.startTime}"`);
  }
  if (input.distance !== undefined) {
    if (!Number.isFinite(input.distance.value) || input.distance.value <= 0) {
      throw new GarminError("distance.value must be a positive number");
    }
    if (!DISTANCE_UNITS.has(input.distance.unit)) {
      throw new GarminError(`distance.unit must be meter, kilometer, yard or mile; got "${input.distance.unit}"`);
    }
  }
  const body: Record<string, unknown> = { eventName: input.name, date: formatDate(input.date) };
  if (input.startTime !== undefined) {
    body["eventTimeLocal"] = { startTimeHhMm: input.startTime, timeZoneId: input.timeZoneId };
  }
  if (input.eventType !== undefined) body["eventType"] = input.eventType;
  if (input.race !== undefined) body["race"] = input.race;
  if (input.distance !== undefined) {
    body["completionTarget"] = { ...input.distance, unitType: "distance" };
  }
  if (input.goalTimeSeconds !== undefined || input.primary !== undefined) {
    body["eventCustomization"] = {
      customGoal: input.goalTimeSeconds === undefined ? null : timeGoal(input.goalTimeSeconds),
      isPrimaryEvent: input.primary ?? false,
    };
  }
  if (input.location !== undefined) body["location"] = input.location;
  if (input.url !== undefined) body["url"] = input.url;
  if (input.note !== undefined) body["note"] = input.note;
  return host.client.connectapi<CalendarEvent>("/calendar-service/event", { method: "POST", json: body });
}

/**
 * Changes an event's name, date, location, link, note, race flag or goal time.
 *
 * READ-MODIFY-WRITE: GETs the stored event, overlays `changes`, and PUTs the whole record back to
 * `/calendar-service/event/{eventId}`. Garmin answers the PUT with no body, so this resolves to
 * `null`; read the event again to see it. Two concurrent callers can clobber each other.
 */
export async function updateCalendarEvent(
  host: CalendarHost,
  eventId: number | string,
  changes: CalendarEventUpdate,
): Promise<unknown> {
  if (Object.values(changes).every((v) => v === undefined)) {
    throw new GarminError("updateCalendarEvent needs at least one field to change");
  }
  if (changes.name !== undefined && !changes.name.trim()) {
    throw new GarminError("updateCalendarEvent cannot set an empty name");
  }
  const path = `/calendar-service/event/${pathSegment(eventId)}`;
  const current = await host.client.connectapi<CalendarEvent>(path);
  if (!current) {
    throw new GarminError(`Cannot update calendar event ${String(eventId)}: Garmin returned nothing`);
  }
  const body: CalendarEvent = { ...current };
  if (changes.name !== undefined) body.eventName = changes.name;
  if (changes.date !== undefined) body.date = formatDate(changes.date);
  if (changes.location !== undefined) body.location = changes.location;
  if (changes.url !== undefined) body.url = changes.url;
  if (changes.note !== undefined) body.note = changes.note;
  if (changes.race !== undefined) body.race = changes.race;
  if (changes.goalTimeSeconds !== undefined) {
    body.eventCustomization = {
      ...current.eventCustomization,
      customGoal: changes.goalTimeSeconds === null ? null : timeGoal(changes.goalTimeSeconds),
    };
  }
  return host.client.connectapi(path, { method: "PUT", json: body });
}

/**
 * `DELETE /calendar-service/event/{eventId}`. Resolves to `null`; a later `getCalendarEvent` on
 * the same id is a 404. IRREVERSIBLE.
 */
export async function deleteCalendarEvent(host: CalendarHost, eventId: number | string): Promise<unknown> {
  return host.client.connectapi(`/calendar-service/event/${pathSegment(eventId)}`, { method: "DELETE" });
}
