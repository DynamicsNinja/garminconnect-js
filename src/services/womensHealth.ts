/**
 * ============================================================================================
 * STANDING EXCEPTION to this project's write-verification policy — DO NOT REMOVE THIS COMMENT
 * ============================================================================================
 *
 * Every other service in this library live-verifies its writes with a create -> read-back ->
 * (delete, where possible) round-trip against a dedicated, empty Garmin test account. The five
 * write methods in THIS file (`updateMenstrualDailyLog`, `updateMenstrualCalendar`,
 * `initMenstrualCycleSetup`, `confirmMenstrualPeriodStart`, `updateMenstrualSettings`) are
 * deliberately EXCLUDED from that policy by default and MUST NOT be executed against any live
 * account — not with synthetic values, not "just to see the error shape."
 *
 * ONE EXPLICIT EXEMPTION, granted by the repo owner on 2026-09-23: the dedicated throwaway test
 * account (profileId 151388919) may be written to, on the stated grounds that it is a blank
 * account created solely for testing and that permanent residue there does not matter. That
 * exemption is account-scoped and does not generalise: `scripts/seed-test-account.ts` still
 * refuses to run unless the live profileId matches GARMIN_TEST_PROFILE_ID, and no other account
 * is covered by it. Anyone reusing this library must treat the default rule above as binding.
 *
 * Why: these are irreversible writes to real health-data categories (menstrual-cycle and
 * pregnancy records). None of the five has a known delete/undo endpoint.
 * `initMenstrualCycleSetup` and `updateMenstrualSettings`
 * plausibly alter account-level configuration (cycle-tracking setup, tracking-preference flags)
 * rather than a single dated record that could plausibly be overwritten back to a neutral state.
 * Unlike other services where an unverified unit conversion was judged a worse risk than
 * permanent throwaway-account residue (see gear's `createGear` duration conversion), there is no
 * equivalent forcing argument here: no unit conversion to get backwards, no silent-corruption
 * risk of the "93 kg -> 93,000 kg" kind that only a read-back would catch.
 *
 * These five writes ship IMPLEMENTED and UNIT-TESTED (against MSW-mocked responses only) and are
 * marked in AGENTS.md with the reason stated. Their unit tests — including literal composed-URL
 * and composed-body assertions — were for a long time the ONLY verification they had; under the
 * 2026-09-23 exemption above they are additionally exercised against the test account by
 * `scripts/seed-test-account.ts`. `scripts/smoke-writes.ts` still intentionally has no
 * `womensHealth` entry: the exemption covers a deliberate, gated, one-account seeding run, not
 * routine inclusion in the general write harness.
 *
 * The six read methods in this file (`getMenstrualDataForDate`, `getMenstrualCalendarData`,
 * `getMenstrualLastConfirmed`, `getMenstrualCycleSummary`, `getMenstrualReports`,
 * `getPregnancySummary`) are ordinary GETs with no side effects and ARE live-verified as normal
 * via `scripts/smoke-reads.ts` — that part of this service follows the standard policy.
 */

import { pathSegment } from "../util/validate.js";

import { GarminError } from "../errors.js";
import type { GarminClient } from "../client.js";
import { formatDate, formatGmtTimestamp } from "../util/date.js";
import type {
  MenstrualCalendarData,
  MenstrualCycleSummary,
  MenstrualDayView,
  MenstrualLastConfirmed,
  MenstrualReports,
  PregnancySummary,
} from "../types/womensHealth.js";

/**
 * `getUserProfile()` is used only as a best-effort source of `userProfilePk` for the write
 * bodies below (see `resolveUserProfilePk`). `Garmin` already implements this shape via its cached `getUserProfile()`.
 */
export interface WomensHealthHost {
  readonly client: GarminClient;
  getUserProfile(): Promise<{ profileId: number; [key: string]: unknown }>;
}

const VALID_REPORT_CYCLE_COUNTS = new Set([1, 6, 12]);

/**
 * `userProfilePk` goes into the write bodies when it is known. Best-effort: fetch the social
 * profile, use its `profileId` if present, and silently omit the field if the fetch fails, rather
 * than failing an otherwise-valid write over a profile-lookup hiccup.
 */
async function resolveUserProfilePk(host: WomensHealthHost): Promise<number | undefined> {
  try {
    const profile = await host.getUserProfile();
    return typeof profile.profileId === "number" ? profile.profileId : undefined;
  } catch {
    return undefined;
  }
}

// --- reads ---

/**
 * Passes Garmin's response through unchecked.
 */
export async function getMenstrualDataForDate(
  host: WomensHealthHost,
  fordate: string | Date,
): Promise<MenstrualDayView | null> {
  return host.client.connectapi<MenstrualDayView>(
    `/periodichealth-service/menstrualcycle/dayview/${pathSegment(formatDate(fordate))}`,
  );
}

/**
 * Passes Garmin's response through unchecked. Garmin rejects windows of 92+ inclusive days (keep
 * the range <= 90 days); this is NOT enforced here and is left to the caller.
 */
export async function getMenstrualCalendarData(
  host: WomensHealthHost,
  startdate: string | Date,
  enddate: string | Date,
): Promise<MenstrualCalendarData | null> {
  const start = formatDate(startdate);
  const end = formatDate(enddate);
  return host.client.connectapi<MenstrualCalendarData>(
    `/periodichealth-service/menstrualcycle/calendar/${pathSegment(start)}/${pathSegment(end)}`,
  );
}

/**
 * Passes Garmin's response through unchecked.
 */
export async function getMenstrualLastConfirmed(
  host: WomensHealthHost,
  fordate: string | Date,
): Promise<MenstrualLastConfirmed | null> {
  return host.client.connectapi<MenstrualLastConfirmed>(
    `/periodichealth-service/menstrualcycle/lastconfirmed/${pathSegment(formatDate(fordate))}`,
  );
}

/**
 * Passes Garmin's response through unchecked.
 */
export async function getMenstrualCycleSummary(
  host: WomensHealthHost,
  fordate: string | Date,
): Promise<MenstrualCycleSummary | null> {
  return host.client.connectapi<MenstrualCycleSummary>(
    `/periodichealth-service/menstrualcycle/summary/${pathSegment(formatDate(fordate))}`,
  );
}

/**
 * Passes Garmin's response through unchecked. `numberOfCycles` is restricted to `{1, 6, 12}` —
 * any other value throws `GarminError`. `todayCalendarDate` defaults to today (routed through
 * `formatDate` either way). `reportType` is trimmed.
 */
export async function getMenstrualReports(
  host: WomensHealthHost,
  fordate: string | Date,
  numberOfCycles = 6,
  options: {
    nextReport?: boolean;
    reportType?: string;
    todayCalendarDate?: string | Date;
  } = {},
): Promise<MenstrualReports | null> {
  const date = formatDate(fordate);
  if (!VALID_REPORT_CYCLE_COUNTS.has(numberOfCycles)) {
    throw new GarminError(
      `numberOfCycles must be one of 1, 6, or 12; got ${numberOfCycles}`,
    );
  }
  const todayCalendarDate = formatDate(options.todayCalendarDate ?? new Date());
  const reportType = (options.reportType ?? "CYCLE").trim();
  return host.client.connectapi<MenstrualReports>(
    `/periodichealth-service/reports/menstrualcycle/${pathSegment(numberOfCycles)}/${pathSegment(date)}`,
    {
      params: {
        next: String(options.nextReport ?? false),
        reportType,
        todayCalendarDate,
      },
    },
  );
}

/**
 * Passes Garmin's response through unchecked.
 */
export async function getPregnancySummary(
  host: WomensHealthHost,
): Promise<PregnancySummary | null> {
  return host.client.connectapi<PregnancySummary>(
    "/periodichealth-service/menstrualcycle/pregnancysnapshot",
  );
}

// --- writes ---
// See the file-level comment at the top of this file: NONE of the following five methods may be
// executed against a live account, ever. All were verified by unit test only.

function isEmptyCollection(value: unknown): boolean {
  if (typeof value === "string") return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object" && value !== null) return Object.keys(value).length === 0;
  return false;
}

/**
 * Drops any key whose value is `undefined` or `null`, and drops any key whose value is an empty string/array/object — EXCEPT
 * `notes`, which is exempt so `notes: ""` (explicit clear) survives while `notes: undefined`
 * (omitted, preserve existing) is dropped by the first rule.
 */
function cleanMenstrualDailyLog(body: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    if (key !== "notes" && isEmptyCollection(value)) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

/**
 * Returns Garmin's raw response (`Promise<unknown>`); live, it is the stored day log.
 *
 * **This is a full-day replace, not a field-level merge**: an omitted field (`undefined`) is
 * dropped from the body entirely (server-side: cleared), while `notes: ""` (explicit empty string)
 * is sent and clears the note; `notes: undefined` preserves the existing note. This distinction is
 * load-bearing.
 *
 * At least one of the optional fields must be provided, or this throws `GarminError` before
 * making a request — guards against an accidental full-day wipe.
 *
 * `discharge` rejects combining `"NO_DISCHARGE"` with any other value.
 *
 * `symptoms`/`moods`/`flow`/`discharge`/`sexDrive`/`sexualActivity` are upper-cased but not
 * checked against a list of allowed values, so an invalid value surfaces as a Garmin-side
 * rejection instead of a local one.
 *
 * `reportTimestamp` uses the UTC formatter (`formatGmtTimestamp`), NOT the local-time formatter
 * used by weight/blood-pressure/hydration writes.
 */
export async function updateMenstrualDailyLog(
  host: WomensHealthHost,
  calendarDate: string | Date,
  options: {
    symptoms?: string[];
    moods?: string[];
    flow?: string;
    discharge?: string[];
    sexDrive?: string;
    sexualActivity?: string;
    notes?: string;
    ovulationDay?: boolean;
  } = {},
): Promise<unknown> {
  const date = formatDate(calendarDate);

  const hasAnyField =
    options.symptoms !== undefined ||
    options.moods !== undefined ||
    options.flow !== undefined ||
    options.discharge !== undefined ||
    options.sexDrive !== undefined ||
    options.sexualActivity !== undefined ||
    options.notes !== undefined ||
    options.ovulationDay !== undefined;
  if (!hasAnyField) {
    throw new GarminError(
      "updateMenstrualDailyLog requires at least one field besides calendarDate " +
        "(this guards against an accidental full-day wipe, since omitted fields are cleared server-side)",
    );
  }

  const discharge = options.discharge?.map((value) => value.toUpperCase());
  if (discharge && discharge.includes("NO_DISCHARGE") && discharge.length > 1) {
    throw new GarminError('"NO_DISCHARGE" cannot be combined with any other discharge value');
  }

  const pk = await resolveUserProfilePk(host);

  const rawBody: Record<string, unknown> = {
    calendarDate: date,
    symptoms: options.symptoms?.map((value) => value.toUpperCase()),
    moods: options.moods?.map((value) => value.toUpperCase()),
    flow: options.flow?.toUpperCase(),
    discharge,
    sexDrive: options.sexDrive?.toUpperCase(),
    sexualActivity: options.sexualActivity?.toUpperCase(),
    notes: options.notes,
    ovulationDay: options.ovulationDay ?? false,
    reportTimestamp: formatGmtTimestamp(new Date()),
    ...(pk !== undefined ? { userProfilePk: pk } : {}),
  };

  return host.client.connectapi(`/periodichealth-service/menstrualcycle/dailylog/${pathSegment(date)}`, {
    method: "POST",
    json: cleanMenstrualDailyLog(rawBody),
  });
}

/** One calendar-day-apart check, used to validate each `cycleDatesLists` group is consecutive. */
function assertConsecutiveDates(dates: string[], groupIndex: number): void {
  for (let i = 1; i < dates.length; i++) {
    const prevMs = Date.parse(`${dates[i - 1]}T00:00:00Z`);
    const curMs = Date.parse(`${dates[i]}T00:00:00Z`);
    if (curMs - prevMs !== 86_400_000) {
      throw new GarminError(
        `cycleDatesLists[${groupIndex}] must be consecutive calendar dates; ` +
          `"${dates[i - 1]}" is not immediately followed by "${dates[i]}"`,
      );
    }
  }
}

/**
 * Returns Garmin's raw response (`Promise<unknown>`).
 *
 * **This is also a full replace, not a merge**: omitted previously-confirmed days within
 * `[startdate, enddate]` are removed server-side by this call.
 *
 * Each inner group of `cycleDatesLists` must be non-empty and consist of consecutive calendar
 * dates, and every date in every group must fall within `[startdate, enddate]` (inclusive) — any
 * violation throws `GarminError` before a request is made. Predicted (unconfirmed) cycles should
 * not be posted here; that is not enforced in code, since there is no way to distinguish a
 * predicted date from a confirmed one at this layer, so it is the caller's responsibility.
 *
 * `reportTimestamp` uses `formatGmtTimestamp` (UTC).
 */
export async function updateMenstrualCalendar(
  host: WomensHealthHost,
  startdate: string | Date,
  enddate: string | Date,
  cycleDatesLists: (string | Date)[][],
  options: { todayCalendarDate?: string | Date } = {},
): Promise<unknown> {
  const start = formatDate(startdate);
  const end = formatDate(enddate);

  const normalizedLists = cycleDatesLists.map((group, index) => {
    if (group.length === 0) {
      throw new GarminError(`cycleDatesLists[${index}] must be non-empty`);
    }
    const formatted = group.map((value) => formatDate(value));
    assertConsecutiveDates(formatted, index);
    for (const date of formatted) {
      if (date < start || date > end) {
        throw new GarminError(
          `cycleDatesLists[${index}] date "${date}" falls outside [${start}, ${end}]`,
        );
      }
    }
    return formatted;
  });

  const todayCalendarDate = formatDate(options.todayCalendarDate ?? new Date());
  const pk = await resolveUserProfilePk(host);

  return host.client.connectapi("/periodichealth-service/menstrualcycle/calendarupdates", {
    method: "POST",
    json: {
      todayCalendarDate,
      startDate: start,
      endDate: end,
      reportTimestamp: formatGmtTimestamp(new Date()),
      cycleDatesLists: normalizedLists,
      futureEditsByFE: true,
      ...(pk !== undefined ? { userProfilePk: pk } : {}),
    },
  });
}

/**
 * Returns Garmin's raw response (`Promise<unknown>`).
 *
 * Garmin's own first-run wizard also PUTs user menstrual settings (tracking-preference flags) in
 * the same save; this method deliberately does NOT do that — call `updateMenstrualSettings`
 * separately if those flags need to change. Not intended for editing an already-configured
 * account.
 *
 * `reportTimestamp` uses `formatGmtTimestamp` (UTC).
 */
export async function initMenstrualCycleSetup(
  host: WomensHealthHost,
  periodStartDate: string | Date,
  periodLength: number,
  cycleLength: number,
): Promise<unknown> {
  const date = formatDate(periodStartDate);
  const pk = await resolveUserProfilePk(host);
  return host.client.connectapi("/periodichealth-service/menstrualcycle/initCycleSetup", {
    method: "POST",
    json: {
      periodStartDate: date,
      periodLength,
      cycleLength,
      reportTimestamp: formatGmtTimestamp(new Date()),
      ...(pk !== undefined ? { userProfilePk: pk } : {}),
    },
  });
}

/**
 * Returns Garmin's raw response (`Promise<unknown>`).
 *
 * Can convert a predicted cycle into a confirmed period (`options.predictedCycle: true`).
 *
 * **Path base is `/periodichealth-service/menstrualcycle` directly** — NOT the `dayview`/
 * `calendar`/`lastconfirmed`/`summary` sub-paths used by the read methods above; easy to mix up.
 *
 * `reportTimestamp` uses `formatGmtTimestamp` (UTC).
 */
export async function confirmMenstrualPeriodStart(
  host: WomensHealthHost,
  periodStartDate: string | Date,
  periodLength: number,
  cycleLength: number,
  options: { predictedCycle?: boolean } = {},
): Promise<unknown> {
  const date = formatDate(periodStartDate);
  const pk = await resolveUserProfilePk(host);
  return host.client.connectapi(`/periodichealth-service/menstrualcycle/${pathSegment(date)}`, {
    method: "POST",
    json: {
      periodStartDate: date,
      periodLength,
      cycleLength,
      predictedCycle: options.predictedCycle ?? false,
      hasSpecifiedCycleLength: true,
      hasSpecifiedPeriodLength: true,
      reportTimestamp: formatGmtTimestamp(new Date()),
      ...(pk !== undefined ? { userProfilePk: pk } : {}),
    },
  });
}

/** Shape of `GET /userprofile-service/userprofile/user-settings`, as consumed by `updateMenstrualSettings`. */
interface UserSettingsSnapshot {
  id?: unknown;
  userMenstrualCycleSettings?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Returns Garmin's raw PUT response (`Promise<unknown>`).
 *
 * `settings` must be a non-empty object, or this throws `GarminError` before any request.
 *
 * **Multi-step**: first GETs the SAME endpoint this then PUTs
 * (`/userprofile-service/userprofile/user-settings` — also what `Garmin.getUserSettings()`
 * hits) to read the current `userMenstrualCycleSettings`, used as
 * an overlay base — the caller's `settings` keys win, keys the caller omitted are preserved from
 * the current state. This is a deliberate direct GET, not `Garmin`'s cached `getUserSettings()`,
 * so the merge always overlays onto freshly-read state rather than a possibly-stale cache.
 *
 * If `options.userSettingsId` is not given, this tries to pull `id` from that same GET response
 * and include it as `id` in the PUT body — only if it is a `number`.
 *
 * Pregnancy-only fields are out of scope for this method.
 */
export async function updateMenstrualSettings(
  host: WomensHealthHost,
  settings: Record<string, unknown>,
  options: { userSettingsId?: number } = {},
): Promise<unknown> {
  if (Object.keys(settings).length === 0) {
    throw new GarminError("settings must be a non-empty object");
  }

  const path = "/userprofile-service/userprofile/user-settings";
  const current = await host.client.connectapi<UserSettingsSnapshot>(path);
  const currentMenstrualSettings = current?.userMenstrualCycleSettings ?? {};
  const merged = { ...currentMenstrualSettings, ...settings };

  let userSettingsId = options.userSettingsId;
  if (userSettingsId === undefined && typeof current?.id === "number") {
    userSettingsId = current.id;
  }

  return host.client.connectapi(path, {
    method: "PUT",
    json: {
      userMenstrualCycleSettings: merged,
      ...(userSettingsId !== undefined ? { id: userSettingsId } : {}),
    },
  });
}
