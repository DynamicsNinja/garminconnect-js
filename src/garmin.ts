import type { GarminClient } from "./client.js";
import { GarminError } from "./errors.js";
import * as activities from "./services/activities.js";
import * as badges from "./services/badges.js";
import * as bodyComposition from "./services/bodyComposition.js";
import * as calendar from "./services/calendar.js";
import * as courses from "./services/courses.js";
import * as devices from "./services/devices.js";
import * as gear from "./services/gear.js";
import * as goals from "./services/goals.js";
import * as golf from "./services/golf.js";
import * as metrics from "./services/metrics.js";
import * as misc from "./services/misc.js";
import * as nutrition from "./services/nutrition.js";
import * as trainingPlans from "./services/trainingPlans.js";
import * as weight from "./services/weight.js";
import * as wellness from "./services/wellness.js";
import * as userProfile from "./services/userProfile.js";
import * as workouts from "./services/workouts.js";
import * as womensHealth from "./services/womensHealth.js";
import type {
  ActivitiesForDateResponse,
  Activity,
  ActivityDetails,
  ActivityDownloadFormat,
  ActivityEventType,
  ActivityEventTypeKey,
  ActivityExerciseSets,
  ActivityFeel,
  ActivityGear,
  ActivityHrInTimezones,
  ActivityPowerInTimezones,
  ActivitySplitSummaries,
  ActivitySplits,
  ActivityTypedSplits,
  ActivityTypesResponse,
  ActivityWeather,
  GearActivity,
  GearLinkResult,
  ImportActivityResult,
  PersonalRecords,
  ProgressSummary,
  UploadActivityResult,
} from "./types/activities.js";
import type {
  AdhocChallenge,
  AvailableBadgeChallenge,
  Badge,
  BadgeChallenge,
  BadgeDetail,
  InprogressVirtualChallenge,
  NonCompletedBadgeChallenge,
} from "./types/badges.js";
import type { BodyCompositionRange } from "./types/bodyComposition.js";
import type { CalendarEvent, CalendarEventInput, CalendarEventUpdate } from "./types/calendar.js";
import type { Course, CourseInput, CourseList, CourseUpdate } from "./types/courses.js";
import type {
  Device,
  DeviceLastUsed,
  DeviceSettings,
  PrimaryTrainingDevice,
} from "./types/devices.js";
import type { Gear, GearDefaults, GearStats, GearUsageType } from "./types/gear.js";
import type { Goal, GoalStatus } from "./types/goals.js";
import type {
  GolfClubStats,
  GolfScorecardDetail,
  GolfScorecardSummary,
  GolfShotData,
  GolfUserStats,
} from "./types/golf.js";
import type {
  CyclingFtpResult,
  EnduranceScoreResult,
  FitnessAgeResult,
  FtpAggregation,
  FtpRangeResult,
  HeartRateZoneEntry,
  HeartRateZoneUpdate,
  HillScoreResult,
  LactateThresholdLatest,
  LactateThresholdRange,
  MaxMetricsResult,
  PowerZoneEntry,
  PowerZonesForSportResult,
  RacePredictionsResult,
  RunningToleranceAggregation,
  RunningToleranceEntry,
  TrainingReadinessEntry,
  TrainingStatusResult,
} from "./types/metrics.js";
import type { GraphqlResult, LifestyleLoggingData, ReloadRequestResult } from "./types/misc.js";
import type {
  CustomFoodInput,
  CustomFoodList,
  Food,
  FoodLogInput,
  FoodSearchResult,
  NutritionDailyFoodLog,
  NutritionDailyMeals,
  NutritionDailySettings,
  NutritionFoodLogRange,
  QuickAddInput,
} from "./types/nutrition.js";
import type {
  AdaptiveTrainingPlanDetail,
  TrainingPlanDetail,
  TrainingPlansResult,
} from "./types/trainingPlans.js";
import type { UserprofileSettings } from "./types/userProfile.js";
import type { DailyWeighIns, WeighInRange } from "./types/weight.js";
import type {
  BloodPressureRange,
  BloodPressureSetResult,
  BodyBatteryEntry,
  BodyBatteryEvent,
  CaloriesDailyEntry,
  DailyEventsData,
  DailyStatsEntry,
  DailyStatsType,
  DailyStepsEntry,
  DailyStressData,
  FloorsData,
  HeartRateData,
  HrvData,
  HrvDataRange,
  HydrationLogResult,
  IntensityMinutesData,
  RespirationData,
  RhrDailyEntry,
  RhrDayData,
  SleepDailyEntry,
  SleepData,
  Spo2Data,
  StatsAndBody,
  StepsEntry,
  UserSummary,
  WeeklyIntensityMinutesEntry,
  WeeklyStepsEntry,
  WeeklyStressEntry,
} from "./types/wellness.js";
import type {
  MenstrualCalendarData,
  MenstrualCycleSummary,
  MenstrualDayView,
  MenstrualLastConfirmed,
  MenstrualReports,
  PregnancySummary,
} from "./types/womensHealth.js";
import type {
  CalendarItem,
  CalendarMonth,
  DeviceMessage,
  ScheduledWorkoutSummary,
  TrainingPlanWorkoutSchedule,
  WorkoutInput,
  WorkoutRecord,
} from "./types/workouts.js";
import type { WeightScaleFields } from "./util/fit.js";

/** The account's social profile, from `/userprofile-service/socialProfile`. */
export interface SocialProfile {
  /** The name date-scoped endpoints put in their URLs. */
  displayName: string;
  /** The account's user name. */
  userName: string;
  /** The account holder's full name. */
  fullName: string;
  /** The profile's numeric id. */
  profileId: number;
  [key: string]: unknown;
}

/** Response of `/userprofile-service/userprofile/user-settings`. */
export interface UserSettings {
  /** The settings record's id. */
  id?: number;
  /** Profile data; `measurementSystem` is what `unitSystem()` returns. */
  userData?: {
    measurementSystem?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * The Garmin Connect API, one method per endpoint. Wraps a signed-in `GarminClient`:
 *
 * ```ts
 * const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
 * if (!(await client.loadTokens())) throw new Error("Not signed in: call client.login() first");
 * const garmin = new Garmin(client);
 * const summary = await garmin.getUserSummary("2026-09-22");
 * ```
 *
 * Calendar dates accept a `YYYY-MM-DD` string or a `Date` (formatted as a UTC date). Methods throw
 * the `GarminError` subclasses exported by this package.
 */
export class Garmin {
  #profile: Promise<SocialProfile> | null = null;
  #settings: Promise<UserSettings> | null = null;

  /** Wraps a client. Sign it in (`login` or `loadTokens`) before calling a method. */
  constructor(
    /** The client every request goes through. */
    readonly client: GarminClient,
  ) {}

  /** Cached per instance; every date-scoped endpoint needs the display name. */
  getUserProfile(): Promise<SocialProfile> {
    this.#profile ??= (async () => {
      const profile = await this.client.connectapi<SocialProfile>(
        "/userprofile-service/socialProfile",
      );
      if (!profile) throw new GarminError("Garmin returned no user profile");
      return profile;
    })().catch((error: unknown) => {
      this.#profile = null; // allow a retry on the next call
      throw error;
    });
    return this.#profile;
  }

  /** Cached per instance, same eviction-on-failure pattern as `getUserProfile()`. */
  getUserSettings(): Promise<UserSettings> {
    this.#settings ??= (async () => {
      const settings = await this.client.connectapi<UserSettings>(
        "/userprofile-service/userprofile/user-settings",
      );
      if (!settings) throw new GarminError("Garmin returned no user settings");
      return settings;
    })().catch((error: unknown) => {
      this.#settings = null; // allow a retry on the next call
      throw error;
    });
    return this.#settings;
  }

  /** The account's display name, which date-scoped endpoints put in their URLs. Cached. */
  async displayName(): Promise<string> {
    return (await this.getUserProfile()).displayName;
  }

  /** The account holder's full name, from the cached user profile. */
  async fullName(): Promise<string> {
    return (await this.getUserProfile()).fullName;
  }

  /** The account's user name, from the cached user profile. */
  async userName(): Promise<string> {
    return (await this.getUserProfile()).userName;
  }

  /**
   * `measurementSystem` lives on `/userprofile-service/userprofile/user-settings`
   * (under `userData`), not on the social profile. A convenience accessor, not
   * a data endpoint: returns `undefined` rather than throwing if the payload
   * shape is missing.
   */
  async unitSystem(): Promise<string | undefined> {
    return (await this.getUserSettings()).userData?.measurementSystem;
  }

  // --- userProfile ---
  /**
   * The account's profile settings record, from `/userprofile-service/userprofile/settings`.
   * Distinct from `getUserSettings()` ("user-settings"): the two paths are one character apart.
   */
  getUserprofileSettings(): Promise<UserprofileSettings | null> {
    return userProfile.getUserprofileSettings(this);
  }
  /**
   * Whether the account has a Garmin Connect+ subscription, from the cached user profile. The
   * methods in `CONNECT_PLUS_METHODS` need it and throw `GarminConnectPlusRequiredError` without.
   */
  hasConnectPlus(): Promise<boolean> {
    return userProfile.hasConnectPlus(this);
  }

  // --- wellness ---
  /** The daily summary for one date: steps, distance, calories and the rest of the day's totals. */
  getUserSummary(cdate: string | Date): Promise<UserSummary> {
    return wellness.getUserSummary(this, cdate);
  }
  /** Alias of getUserSummary. */
  getStats(cdate: string | Date): Promise<UserSummary> {
    return wellness.getUserSummary(this, cdate);
  }
  /** Step counts for one date, as a series of time intervals; `[]` if there are none. */
  getStepsData(cdate: string | Date): Promise<StepsEntry[]> {
    return wellness.getStepsData(this, cdate);
  }
  /** Heart-rate samples plus resting, min and max heart rate for one date. */
  getHeartRates(cdate: string | Date): Promise<HeartRateData> {
    return wellness.getHeartRates(this, cdate);
  }
  /** Sleep data for one date: the night's summary and its sleep levels. */
  getSleepData(cdate: string | Date): Promise<SleepData | null> {
    return wellness.getSleepData(this, cdate);
  }
  /** Heart-rate variability (HRV) readings and status for one date. */
  getHrvData(cdate: string | Date): Promise<HrvData | null> {
    return wellness.getHrvData(this, cdate);
  }
  /** Daily Body Battery reports for a date or a date range (`enddate` defaults to `startdate`). */
  getBodyBattery(startdate: string | Date, enddate?: string | Date): Promise<BodyBatteryEntry[]> {
    return wellness.getBodyBattery(this, startdate, enddate);
  }
  /** Body Battery events for one date. */
  getBodyBatteryEvents(cdate: string | Date): Promise<BodyBatteryEvent[] | null> {
    return wellness.getBodyBatteryEvents(this, cdate);
  }
  /** Floors climbed and descended for one date. Throws `GarminError` if Garmin returns nothing. */
  getFloors(cdate: string | Date): Promise<FloorsData> {
    return wellness.getFloors(this, cdate);
  }
  /** Daily step totals over a date range; ranges over 28 days are fetched in chunks. */
  getDailySteps(start: string | Date, end: string | Date): Promise<DailyStepsEntry[] | null> {
    return wellness.getDailySteps(this, start, end);
  }
  /** Per-day calorie or step totals; ranges over 28 days are chunked. */
  getDailyStats(
    start: string | Date,
    end: string | Date,
    statsType: DailyStatsType,
  ): Promise<DailyStatsEntry[]> {
    return wellness.getDailyStats(this, start, end, statsType);
  }
  /** Weekly step totals for the `weeks` weeks (default 52) ending on `end`. */
  getWeeklySteps(end: string | Date, weeks?: number): Promise<WeeklyStepsEntry[] | null> {
    return wellness.getWeeklySteps(this, end, weeks);
  }
  /** Weekly stress averages for the `weeks` weeks (default 52) ending on `end`. */
  getWeeklyStress(end: string | Date, weeks?: number): Promise<WeeklyStressEntry[] | null> {
    return wellness.getWeeklyStress(this, end, weeks);
  }
  /** Weekly intensity-minute totals between two dates. */
  getWeeklyIntensityMinutes(
    start: string | Date,
    end: string | Date,
  ): Promise<WeeklyIntensityMinutesEntry[] | null> {
    return wellness.getWeeklyIntensityMinutes(this, start, end);
  }
  /** `getUserSummary` merged with the day's body-composition averages. */
  getStatsAndBody(cdate: string | Date): Promise<StatsAndBody> {
    return wellness.getStatsAndBody(this, cdate);
  }
  /**
   * Records a blood-pressure reading (systolic 70-260, diastolic 40-150, pulse 20-250). `when`
   * defaults to now.
   */
  setBloodPressure(
    systolic: number,
    diastolic: number,
    pulse?: number,
    when?: Date,
    notes?: string,
  ): Promise<BloodPressureSetResult | null> {
    return wellness.setBloodPressure(this, systolic, diastolic, pulse, when, notes);
  }
  /** Blood-pressure readings for a date or a date range (`enddate` defaults to `startdate`). */
  getBloodPressure(
    startdate: string | Date,
    enddate?: string | Date,
  ): Promise<BloodPressureRange | null> {
    return wellness.getBloodPressure(this, startdate, enddate);
  }
  /** Deletes one blood-pressure reading by its `version`, taken from `getBloodPressure`. */
  deleteBloodPressure(version: number | string, cdate: string | Date): Promise<unknown> {
    return wellness.deleteBloodPressure(this, version, cdate);
  }
  /** Logs water intake in milliliters (negative values subtract). There is no delete endpoint. */
  addHydrationData(
    valueInMl: number,
    when?: Date,
    cdate?: string | Date,
  ): Promise<HydrationLogResult | null> {
    return wellness.addHydrationData(this, valueInMl, when, cdate);
  }
  /** The hydration log for one date. */
  getHydrationData(cdate: string | Date): Promise<HydrationLogResult | null> {
    return wellness.getHydrationData(this, cdate);
  }
  /** Breathing-rate data for one date. */
  getRespirationData(cdate: string | Date): Promise<RespirationData | null> {
    return wellness.getRespirationData(this, cdate);
  }
  /** Pulse-oximeter (SpO2) readings for one date. */
  getSpo2Data(cdate: string | Date): Promise<Spo2Data | null> {
    return wellness.getSpo2Data(this, cdate);
  }
  /** Moderate and vigorous intensity minutes for one date. */
  getIntensityMinutesData(cdate: string | Date): Promise<IntensityMinutesData | null> {
    return wellness.getIntensityMinutesData(this, cdate);
  }
  /** All-day stress levels for one date. */
  getAllDayStress(cdate: string | Date): Promise<DailyStressData | null> {
    return wellness.getAllDayStress(this, cdate);
  }
  /** Alias of `getAllDayStress`. */
  getStressData(cdate: string | Date): Promise<DailyStressData | null> {
    return wellness.getStressData(this, cdate);
  }
  /** Daily events for one date (Garmin's `dailyEvents` feed). */
  getAllDayEvents(cdate: string | Date): Promise<DailyEventsData | null> {
    return wellness.getAllDayEvents(this, cdate);
  }
  /** Per-night sleep stats over a date range; ranges over 28 days are fetched in chunks. */
  getSleepDaily(start: string | Date, end: string | Date): Promise<SleepDailyEntry[]> {
    return wellness.getSleepDaily(this, start, end);
  }
  /** Resting heart rate for one date. */
  getRhrDay(cdate: string | Date): Promise<RhrDayData | null> {
    return wellness.getRhrDay(this, cdate);
  }
  /** Resting heart rate per day over a date range, as `{ calendarDate, value }` rows. */
  getRhrDaily(start: string | Date, end: string | Date): Promise<RhrDailyEntry[]> {
    return wellness.getRhrDaily(this, start, end);
  }
  /** Active, resting and total calories per day over a date range. */
  getCaloriesDaily(start: string | Date, end: string | Date): Promise<CaloriesDailyEntry[]> {
    return wellness.getCaloriesDaily(this, start, end);
  }
  /** Daily HRV summaries over a date range. */
  getHrvDataRange(start: string | Date, end: string | Date): Promise<HrvDataRange | null> {
    return wellness.getHrvDataRange(this, start, end);
  }

  // --- activities ---
  /** The total number of activities on the account. */
  countActivities(): Promise<number> {
    return activities.countActivities(this);
  }
  /** A page of activities, newest first (`start` defaults to 0, `limit` to 20). */
  getActivities(start?: number, limit?: number): Promise<Activity[]> {
    return activities.getActivities(this, start, limit);
  }
  /** The activities recorded on one date. */
  getActivitiesForDate(fordate: string | Date): Promise<ActivitiesForDateResponse | null> {
    return activities.getActivitiesForDate(this, fordate);
  }
  /**
   * Every activity between two dates, optionally filtered by activity type. Pages through the
   * results internally.
   */
  getActivitiesByDate(
    startdate: string | Date,
    enddate?: string | Date,
    activitytype?: string,
    sortorder?: string,
  ): Promise<Activity[]> {
    return activities.getActivitiesByDate(this, startdate, enddate, activitytype, sortorder);
  }
  /** The most recent activity, or `null` if there are none. */
  getLastActivity(): Promise<Activity | null> {
    return activities.getLastActivity(this);
  }
  /** One activity's summary by id. Throws `GarminError` if Garmin returns nothing. */
  getActivity(activityId: number | string): Promise<Activity> {
    return activities.getActivity(this, activityId);
  }
  /** Every activity type Garmin knows: `{ typeId, typeKey, parentTypeId, ... }`. */
  getActivityTypes(): Promise<ActivityTypesResponse | null> {
    return activities.getActivityTypes(this);
  }
  /** Deletes an activity. IRREVERSIBLE. Resolves to `null` on success. */
  deleteActivity(activityId: number | string): Promise<unknown> {
    return activities.deleteActivity(this, activityId);
  }
  /** Renames an activity. Resolves to `null` on success. */
  setActivityName(activityId: number | string, activityName: string): Promise<unknown> {
    return activities.setActivityName(this, activityId, activityName);
  }
  /** Changes an activity's type. Resolves to `null` on success. */
  setActivityType(
    activityId: number | string,
    typeId: number,
    typeKey: string,
    parentTypeId: number,
  ): Promise<unknown> {
    return activities.setActivityType(this, activityId, typeId, typeKey, parentTypeId);
  }
  /** Sets an activity's description. Resolves to `null` on success. */
  setActivityDescription(activityId: number | string, description: string): Promise<unknown> {
    return activities.setActivityDescription(this, activityId, description);
  }
  /** The event types `setActivityEventType` accepts. */
  getActivityEventTypes(): Promise<ActivityEventType[] | null> {
    return activities.getActivityEventTypes(this);
  }
  /** Files an activity under an event type, e.g. "race" or "training". */
  setActivityEventType(
    activityId: number | string,
    eventType: ActivityEventTypeKey,
  ): Promise<unknown> {
    return activities.setActivityEventType(this, activityId, eventType);
  }
  /** Perceived effort (RPE) 1-10, or `null` to clear it. */
  setActivityPerceivedEffort(activityId: number | string, rpe: number | null): Promise<unknown> {
    return activities.setActivityPerceivedEffort(this, activityId, rpe);
  }
  /** "How did you feel?": 0, 25, 50, 75 or 100, or `null` to clear it. */
  setActivityFeel(activityId: number | string, feel: ActivityFeel | null): Promise<unknown> {
    return activities.setActivityFeel(this, activityId, feel);
  }
  /** Creates a manual activity from a payload sent to Garmin verbatim. */
  createManualActivityFromJson(payload: Record<string, unknown>): Promise<unknown> {
    return activities.createManualActivityFromJson(this, payload);
  }
  /**
   * Creates a manual activity from a distance in km and a duration in minutes. `startDatetime` is a
   * local timestamp with milliseconds, e.g. `"2026-09-22T10:00:00.000"`.
   */
  createManualActivity(
    startDatetime: string,
    timeZone: string,
    typeKey: string,
    distanceKm: number,
    durationMin: number,
    activityName: string,
  ): Promise<unknown> {
    return activities.createManualActivity(
      this,
      startDatetime,
      timeZone,
      typeKey,
      distanceKm,
      durationMin,
      activityName,
    );
  }
  /**
   * Imports a `.fit`, `.gpx` or `.tcx` file as an activity. A duplicate raises
   * `GarminConnectionError`.
   */
  importActivity(file: Blob, filename: string): Promise<ImportActivityResult> {
    return activities.importActivity(this, file, filename);
  }
  /** Uploads an activity file through Garmin's plain device-sync upload path. */
  uploadActivity(file: Blob, filename: string): Promise<UploadActivityResult | null> {
    return activities.uploadActivity(this, file, filename);
  }
  /** The account's personal records, one row per record type. */
  getPersonalRecord(): Promise<PersonalRecords | null> {
    return activities.getPersonalRecord(this);
  }
  /** Downloads an activity file: `"ORIGINAL"` (the default), TCX, GPX, KML or CSV. */
  downloadActivity(activityId: number | string, format?: ActivityDownloadFormat): Promise<Buffer> {
    return activities.downloadActivity(this, activityId, format);
  }
  /** An activity's laps. */
  getActivitySplits(activityId: number | string): Promise<ActivitySplits | null> {
    return activities.getActivitySplits(this, activityId);
  }
  /** An activity's typed splits, richer than `getActivitySplits` for some sports. */
  getActivityTypedSplits(activityId: number | string): Promise<ActivityTypedSplits | null> {
    return activities.getActivityTypedSplits(this, activityId);
  }
  /** Summaries of an activity's splits. */
  getActivitySplitSummaries(activityId: number | string): Promise<ActivitySplitSummaries | null> {
    return activities.getActivitySplitSummaries(this, activityId);
  }
  /** The weather recorded for an activity. */
  getActivityWeather(activityId: number | string): Promise<ActivityWeather | null> {
    return activities.getActivityWeather(this, activityId);
  }
  /** Time spent in each heart-rate zone during an activity. */
  getActivityHrInTimezones(activityId: number | string): Promise<ActivityHrInTimezones | null> {
    return activities.getActivityHrInTimezones(this, activityId);
  }
  /** Time spent in each power zone during an activity. */
  getActivityPowerInTimezones(
    activityId: number | string,
  ): Promise<ActivityPowerInTimezones | null> {
    return activities.getActivityPowerInTimezones(this, activityId);
  }
  /** An activity's time series and GPS track, capped at `maxchart`/`maxpoly` points. */
  getActivityDetails(
    activityId: number | string,
    maxchart?: number,
    maxpoly?: number,
  ): Promise<ActivityDetails | null> {
    return activities.getActivityDetails(this, activityId, maxchart, maxpoly);
  }
  /** A strength activity's exercise sets. */
  getActivityExerciseSets(activityId: number | string): Promise<ActivityExerciseSets | null> {
    return activities.getActivityExerciseSets(this, activityId);
  }
  /** Replaces ALL of a strength activity's exercise sets with `payload`. */
  setActivityExerciseSets(
    activityId: number | string,
    payload: ActivityExerciseSets,
  ): Promise<unknown> {
    return activities.setActivityExerciseSets(this, activityId, payload);
  }
  /** The gear linked to an activity. */
  getActivityGear(activityId: number | string): Promise<ActivityGear[] | null> {
    return activities.getActivityGear(this, activityId);
  }
  /** Activities that used a piece of gear (`limit` capped at 1000); `[]` if it is unknown. */
  getGearActivities(gearUUID: string, limit?: number): Promise<GearActivity[]> {
    return activities.getGearActivities(this, gearUUID, limit);
  }
  /** Links a piece of gear to an activity. */
  addGearToActivity(gearUUID: string, activityId: number | string): Promise<GearLinkResult | null> {
    return activities.addGearToActivity(this, gearUUID, activityId);
  }
  /** Unlinks a piece of gear from an activity. */
  removeGearFromActivity(
    gearUUID: string,
    activityId: number | string,
  ): Promise<GearLinkResult | null> {
    return activities.removeGearFromActivity(this, gearUUID, activityId);
  }
  /**
   * Totals of one metric (default `distance`) between two dates, grouped by activity type by
   * default.
   */
  getProgressSummaryBetweenDates(
    startdate: string | Date,
    enddate: string | Date,
    metric?: string,
    groupbyactivities?: boolean,
  ): Promise<ProgressSummary | null> {
    return activities.getProgressSummaryBetweenDates(
      this,
      startdate,
      enddate,
      metric,
      groupbyactivities,
    );
  }
  /** Downloads the Health Snapshot recorded on a date, as raw bytes. */
  downloadHealthSnapshot(requestedDate: string | Date): Promise<Buffer> {
    return activities.downloadHealthSnapshot(this, requestedDate);
  }

  // --- gear ---
  /** Every piece of gear on the account. `userProfileNumber` is the profile's numeric id. */
  getGear(userProfileNumber: number | string): Promise<Gear[] | null> {
    return gear.getGear(this, userProfileNumber);
  }
  /** Creates a piece of gear (shoes, bike and so on). Usage limits are given in km and minutes. */
  createGear(
    gearType: string,
    brand: string,
    model: string,
    name: string,
    firstUseDate: string | Date,
    usageType?: GearUsageType,
    maxUsageDistanceKm?: number,
    maxUsageDurationMin?: number,
    notes?: string,
    activityTypeKeys?: string[],
  ): Promise<unknown> {
    return gear.createGear(
      this,
      gearType,
      brand,
      model,
      name,
      firstUseDate,
      usageType,
      maxUsageDistanceKm,
      maxUsageDurationMin,
      notes,
      activityTypeKeys,
    );
  }
  /** Usage totals for one piece of gear; `{}` if it is unknown. */
  getGearStats(gearUUID: string): Promise<GearStats> {
    return gear.getGearStats(this, gearUUID);
  }
  /** Deletes a piece of gear and its activity history. IRREVERSIBLE. */
  deleteGear(gearUUID: string): Promise<unknown> {
    return gear.deleteGear(this, gearUUID);
  }
  /**
   * Sets which activity types default to this gear. Uses the v2 full-record PUT Garmin's own web
   * client uses (the older dedicated default-gear endpoint is dead).
   */
  setGearActivityDefaults(gearUUID: string, activityTypeKeys: string[]): Promise<unknown> {
    return gear.setGearActivityDefaults(this, gearUUID, activityTypeKeys);
  }
  /** Which gear is the default for which activity types. */
  getGearDefaults(userProfileNumber: number | string): Promise<GearDefaults[] | null> {
    return gear.getGearDefaults(this, userProfileNumber);
  }

  // --- courses ---
  /** Every saved course, as `{ coursesForUser: CourseSummary[] }`. */
  listCourses(): Promise<CourseList | null> {
    return courses.listCourses(this);
  }
  /** One saved course by id. */
  getCourse(courseId: number | string): Promise<Course | null> {
    return courses.getCourse(this, courseId);
  }
  /** Parses a GPX file into a course WITHOUT saving it (`courseId: null`). */
  importCourseGpx(file: Blob, filename: string): Promise<Course> {
    return courses.importCourseGpx(this, file, filename);
  }
  /** Saves a course from a name and at least two geo points. Garmin computes the distance. */
  createCourse(input: CourseInput): Promise<Course | null> {
    return courses.createCourse(this, input);
  }
  /** `importCourseGpx` then `createCourse`, in one call. */
  createCourseFromGpx(
    file: Blob,
    filename: string,
    options?: Omit<CourseInput, "geoPoints" | "coursePoints" | "name"> & { name?: string },
  ): Promise<Course | null> {
    return courses.createCourseFromGpx(this, file, filename, options);
  }
  /** Rename and/or change privacy. Read-modify-write of the whole record. */
  updateCourse(courseId: number | string, changes: CourseUpdate): Promise<Course | null> {
    return courses.updateCourse(this, courseId, changes);
  }
  /** IRREVERSIBLE. A course created seconds ago may 429 "not yet ready"; retry shortly. */
  deleteCourse(courseId: number | string): Promise<unknown> {
    return courses.deleteCourse(this, courseId);
  }
  /** Downloads a saved course as GPX bytes. */
  downloadCourseGpx(courseId: number | string): Promise<Buffer> {
    return courses.downloadCourseGpx(this, courseId);
  }

  // --- devices ---
  /** Every device registered to the account. */
  getDevices(): Promise<Device[] | null> {
    return devices.getDevices(this);
  }
  /** One device's settings, by the `deviceId` from `getDevices`. */
  getDeviceSettings(deviceId: number | string): Promise<DeviceSettings | null> {
    return devices.getDeviceSettings(this, deviceId);
  }
  /** The account's primary training device. */
  getPrimaryTrainingDevice(): Promise<PrimaryTrainingDevice | null> {
    return devices.getPrimaryTrainingDevice(this);
  }
  /**
   * A solar device's charging input for a date or a date range (`enddate` defaults to `startdate`).
   */
  getDeviceSolarData(
    deviceId: number | string,
    startdate: string | Date,
    enddate?: string | Date,
  ): Promise<unknown[]> {
    return devices.getDeviceSolarData(this, deviceId, startdate, enddate);
  }
  /** Every alarm configured on every registered device. */
  getDeviceAlarms(): Promise<unknown[]> {
    return devices.getDeviceAlarms(this);
  }
  /** The device used most recently. */
  getDeviceLastUsed(): Promise<DeviceLastUsed | null> {
    return devices.getDeviceLastUsed(this);
  }

  // --- badges & challenges ---
  /** Badges the account has earned, each with `badgeImageUrls` added. */
  getEarnedBadges(): Promise<Badge[] | null> {
    return badges.getEarnedBadges(this);
  }
  /** Badges the account can still earn, each with `badgeImageUrls` added. */
  getAvailableBadges(): Promise<Badge[] | null> {
    return badges.getAvailableBadges(this);
  }
  /** Badges with progress towards them, from the earned and available lists. */
  getInProgressBadges(): Promise<Badge[]> {
    return badges.getInProgressBadges(this);
  }
  /** One badge with its related series and what earned it. Works for unearned badges. */
  getBadgeDetail(badgeId: number): Promise<BadgeDetail | null> {
    return badges.getBadgeDetail(this, badgeId);
  }
  /** Ad-hoc challenges the account took part in. */
  getAdhocChallenges(start: number, limit: number): Promise<AdhocChallenge[] | null> {
    return badges.getAdhocChallenges(this, start, limit);
  }
  /** Completed badge challenges. Garmin rejects `start=0`; start at 1. */
  getBadgeChallenges(start: number, limit: number): Promise<BadgeChallenge[] | null> {
    return badges.getBadgeChallenges(this, start, limit);
  }
  /** Badge challenges the account can join. Garmin rejects `start=0`; start at 1. */
  getAvailableBadgeChallenges(
    start: number,
    limit: number,
  ): Promise<AvailableBadgeChallenge[] | null> {
    return badges.getAvailableBadgeChallenges(this, start, limit);
  }
  /** Badge challenges joined but not completed. Garmin rejects `start=0`. */
  getNonCompletedBadgeChallenges(
    start: number,
    limit: number,
  ): Promise<NonCompletedBadgeChallenge[] | null> {
    return badges.getNonCompletedBadgeChallenges(this, start, limit);
  }
  /** Virtual challenges in progress. `start` must be at least 1. */
  getInprogressVirtualChallenges(
    start: number,
    limit: number,
  ): Promise<InprogressVirtualChallenge[] | null> {
    return badges.getInprogressVirtualChallenges(this, start, limit);
  }

  // --- weight ---
  /** Weigh-ins between two dates. */
  getWeighIns(startdate: string | Date, enddate: string | Date): Promise<WeighInRange> {
    return weight.getWeighIns(this, startdate, enddate);
  }
  /** Records a weigh-in in `"kg"` (the default) or `"lbs"`. `when` defaults to now. */
  addWeighIn(weightValue: number, unitKey?: "kg" | "lbs", when?: Date): Promise<unknown> {
    return weight.addWeighIn(this, weightValue, unitKey, when);
  }
  /** Deletes one weigh-in, by date and its `weightPk`. */
  deleteWeighIn(cdate: string | Date, weightPk: number): Promise<null> {
    return weight.deleteWeighIn(this, cdate, weightPk);
  }
  /** `addWeighIn` with explicit local and GMT timestamps. */
  addWeighInWithTimestamps(
    weightValue: number,
    unitKey?: "kg" | "lbs",
    dateTimestamp?: string,
    gmtTimestamp?: string,
    when?: Date,
  ): Promise<unknown> {
    return weight.addWeighInWithTimestamps(
      this,
      weightValue,
      unitKey,
      dateTimestamp,
      gmtTimestamp,
      when,
    );
  }
  /** Every weigh-in recorded on one date. */
  getDailyWeighIns(cdate: string | Date): Promise<DailyWeighIns | null> {
    return weight.getDailyWeighIns(this, cdate);
  }
  /** Deletes the weigh-ins recorded on one date and returns how many went. IRREVERSIBLE. */
  deleteWeighIns(cdate: string | Date, deleteAll?: boolean): Promise<number | null> {
    return weight.deleteWeighIns(this, cdate, deleteAll);
  }

  // --- bodyComposition ---
  /** Body-composition data for a date or a date range (`enddate` defaults to `startdate`). */
  getBodyComposition(
    startdate: string | Date,
    enddate?: string | Date,
  ): Promise<BodyCompositionRange | null> {
    return bodyComposition.getBodyComposition(this, startdate, enddate);
  }
  /**
   * Records a weight (kg) with optional body-composition fields such as body fat and muscle
   * mass, uploaded as a `.fit` weight-scale file built in memory.
   */
  addBodyComposition(
    weight: number,
    extra?: WeightScaleFields & { timestamp?: string },
  ): Promise<unknown> {
    return bodyComposition.addBodyComposition(this, weight, extra);
  }

  // --- metrics ---
  /** Max metrics (VO2 max and related values) for one date. */
  getMaxMetrics(cdate: string | Date): Promise<MaxMetricsResult | null> {
    return metrics.getMaxMetrics(this, cdate);
  }
  /** Max metrics (VO2 max and related values) over a date range. */
  getMaxMetricsRange(start: string | Date, end: string | Date): Promise<MaxMetricsResult | null> {
    return metrics.getMaxMetricsRange(this, start, end);
  }
  /** Functional threshold power (FTP) history for a sport over a date range. */
  getFunctionalThresholdPowerRange(
    start: string | Date,
    end: string | Date,
    sport?: string,
    aggregation?: FtpAggregation,
  ): Promise<FtpRangeResult | null> {
    return metrics.getFunctionalThresholdPowerRange(this, start, end, sport, aggregation);
  }
  /**
   * Lactate threshold: the latest values (default), or history over a date range when `latest` is
   * `false`.
   */
  getLactateThreshold(
    latest?: boolean,
    startDate?: string | Date,
    endDate?: string | Date,
    aggregation?: FtpAggregation,
  ): Promise<LactateThresholdLatest | LactateThresholdRange> {
    return metrics.getLactateThreshold(this, latest, startDate, endDate, aggregation);
  }
  /** Training readiness entries for one date. */
  getTrainingReadiness(cdate: string | Date): Promise<TrainingReadinessEntry[] | null> {
    return metrics.getTrainingReadiness(this, cdate);
  }
  /** The training readiness score computed after waking up on a date. */
  getMorningTrainingReadiness(cdate: string | Date): Promise<TrainingReadinessEntry | null> {
    return metrics.getMorningTrainingReadiness(this, cdate);
  }
  /** Endurance score for a date, or weekly aggregates over a date range. */
  getEnduranceScore(
    startdate: string | Date,
    enddate?: string | Date,
  ): Promise<EnduranceScoreResult | null> {
    return metrics.getEnduranceScore(this, startdate, enddate);
  }
  /** Running tolerance over a date range, aggregated weekly (the default) or daily. */
  getRunningTolerance(
    startdate: string | Date,
    enddate: string | Date,
    aggregation?: RunningToleranceAggregation,
  ): Promise<RunningToleranceEntry[] | null> {
    return metrics.getRunningTolerance(this, startdate, enddate, aggregation);
  }
  /** Predicted race times: the latest, or daily/monthly history when all three args are given. */
  getRacePredictions(
    startdate?: string | Date,
    enddate?: string | Date,
    type?: "daily" | "monthly",
  ): Promise<RacePredictionsResult | null> {
    return metrics.getRacePredictions(this, startdate, enddate, type);
  }
  /** Training status for one date. */
  getTrainingStatus(cdate: string | Date): Promise<TrainingStatusResult | null> {
    return metrics.getTrainingStatus(this, cdate);
  }
  /** Fitness age for one date. */
  getFitnessAgeData(cdate: string | Date): Promise<FitnessAgeResult | null> {
    return metrics.getFitnessAgeData(this, cdate);
  }
  /** Hill score for a date, or daily values over a date range. */
  getHillScore(startdate: string | Date, enddate?: string | Date): Promise<HillScoreResult | null> {
    return metrics.getHillScore(this, startdate, enddate);
  }
  /** The latest cycling functional threshold power (FTP). */
  getCyclingFtp(): Promise<CyclingFtpResult | null> {
    return metrics.getCyclingFtp(this);
  }
  /** Heart-rate zone profiles: DEFAULT plus any per-sport ones. */
  getHeartRateZones(): Promise<HeartRateZoneEntry[] | null> {
    return metrics.getHeartRateZones(this);
  }
  /** Changes one heart-rate zone profile and returns it as stored. */
  setHeartRateZones(update: HeartRateZoneUpdate): Promise<HeartRateZoneEntry | null> {
    return metrics.setHeartRateZones(this, update);
  }
  /** Removes a sport's own zone profile; it falls back to DEFAULT. */
  deleteHeartRateZones(sport: string): Promise<unknown> {
    return metrics.deleteHeartRateZones(this, sport);
  }
  /** Power zone profiles. */
  getPowerZones(): Promise<PowerZoneEntry[] | null> {
    return metrics.getPowerZones(this);
  }
  /** Power zones for one sport, e.g. `"CYCLING"`. */
  getPowerZonesForSport(sport: string): Promise<PowerZonesForSportResult | null> {
    return metrics.getPowerZonesForSport(this, sport);
  }

  // --- workouts ---
  /** A page of the workout library (`start` defaults to 0, `limit` to 100). */
  getWorkouts(start?: number, limit?: number): Promise<WorkoutRecord[] | null> {
    return workouts.getWorkouts(this, start, limit);
  }
  /** One workout from the library by id. */
  getWorkoutById(workoutId: number | string): Promise<WorkoutRecord | null> {
    return workouts.getWorkoutById(this, workoutId);
  }
  /** Deletes a workout from the library. IRREVERSIBLE. */
  deleteWorkout(workoutId: number | string): Promise<unknown> {
    return workouts.deleteWorkout(this, workoutId);
  }
  /** Downloads a workout as FIT-file bytes. */
  downloadWorkout(workoutId: number | string): Promise<Buffer> {
    return workouts.downloadWorkout(this, workoutId);
  }
  /**
   * Creates a workout from JSON (an object, an array or a JSON string). `buildWorkout` builds the
   * JSON for you.
   */
  uploadWorkout(
    workoutJson: Record<string, unknown> | unknown[] | string,
  ): Promise<WorkoutRecord | null> {
    return workouts.uploadWorkout(this, workoutJson);
  }
  /** Replaces a stored workout with new JSON (a full replace, not a merge). */
  updateWorkout(
    workoutId: number | string,
    workoutJson: Record<string, unknown> | string,
  ): Promise<WorkoutRecord | null> {
    return workouts.updateWorkout(this, workoutId, workoutJson);
  }
  /** `uploadWorkout` with the running sport type filled in if missing. */
  uploadRunningWorkout(workout: WorkoutInput): Promise<WorkoutRecord | null> {
    return workouts.uploadRunningWorkout(this, workout);
  }
  /** `uploadWorkout` with the cycling sport type filled in if missing. */
  uploadCyclingWorkout(workout: WorkoutInput): Promise<WorkoutRecord | null> {
    return workouts.uploadCyclingWorkout(this, workout);
  }
  /** `uploadWorkout` with the swimming sport type filled in if missing. */
  uploadSwimmingWorkout(workout: WorkoutInput): Promise<WorkoutRecord | null> {
    return workouts.uploadSwimmingWorkout(this, workout);
  }
  /** `uploadWorkout` with the strength-training sport type filled in if missing. */
  uploadStrengthWorkout(workout: WorkoutInput): Promise<WorkoutRecord | null> {
    return workouts.uploadStrengthWorkout(this, workout);
  }
  /**
   * Sends a workout to a device. Defaults to the newest workout and the most recently used device.
   */
  pushWorkoutToDevice(
    workoutId?: number | string,
    deviceId?: number | string,
  ): Promise<DeviceMessage[] | null> {
    return workouts.pushWorkoutToDevice(this, workoutId, deviceId);
  }
  /** The calendar for one month (`month` is 1-12): scheduled workouts, events and more. */
  getScheduledWorkouts(
    year: number | string,
    month: number | string,
  ): Promise<CalendarMonth | null> {
    return workouts.getScheduledWorkouts(this, year, month);
  }
  /** One scheduled workout by its scheduled-workout id. */
  getScheduledWorkoutById(scheduledWorkoutId: number | string): Promise<WorkoutRecord | null> {
    return workouts.getScheduledWorkoutById(this, scheduledWorkoutId);
  }
  /** The next scheduled workout from this month or next, or `{}` if there is none. */
  getNextScheduledWorkout(): Promise<CalendarItem | Record<string, never>> {
    return workouts.getNextScheduledWorkout(this);
  }
  /** Schedules a library workout on a date. */
  scheduleWorkout(
    workoutId: number | string,
    dateStr: string | Date,
  ): Promise<WorkoutRecord | null> {
    return workouts.scheduleWorkout(this, workoutId, dateStr);
  }
  /** Removes a workout from the calendar; the workout stays in the library. */
  unscheduleWorkout(scheduledWorkoutId: number | string): Promise<unknown> {
    return workouts.unscheduleWorkout(this, scheduledWorkoutId);
  }
  /** A Garmin Coach workout by its workoutUuid (getWorkoutById cannot). */
  getAdaptiveWorkout(workoutUuid: string): Promise<WorkoutRecord | null> {
    return workouts.getAdaptiveWorkout(this, workoutUuid);
  }
  /** Every scheduled workout between two dates, as compact summaries. */
  getScheduledWorkoutSummaries(
    startdate: string | Date,
    enddate: string | Date,
  ): Promise<ScheduledWorkoutSummary[]> {
    return workouts.getScheduledWorkoutSummaries(this, startdate, enddate);
  }
  /** Enrolled training plans' workouts around a date, grouped by plan. */
  getTrainingPlanWorkouts(
    calendarDate: string | Date,
    options?: { firstDayOfWeek?: "monday" | "sunday"; lang?: string },
  ): Promise<TrainingPlanWorkoutSchedule[]> {
    return workouts.getTrainingPlanWorkouts(this, calendarDate, options);
  }

  // --- calendar events ---
  /** Every event between two dates, inclusive, or every event on the account with no dates. */
  listCalendarEvents(
    startdate?: string | Date,
    enddate?: string | Date,
  ): Promise<CalendarEvent[] | null> {
    return calendar.listCalendarEvents(this, startdate, enddate);
  }
  /** One calendar event by id. */
  getCalendarEvent(eventId: number | string): Promise<CalendarEvent | null> {
    return calendar.getCalendarEvent(this, eventId);
  }
  /** A race from Garmin's events catalogue by its shareableEventUuid; no subscription needed. */
  getSharedCalendarEvent(shareableEventUuid: string): Promise<CalendarEvent | null> {
    return calendar.getSharedCalendarEvent(this, shareableEventUuid);
  }
  /** Adds a race or other event to the calendar. Always stored PRIVATE. */
  createCalendarEvent(input: CalendarEventInput): Promise<CalendarEvent | null> {
    return calendar.createCalendarEvent(this, input);
  }
  /** Read-modify-write of the stored event; resolves to `null`. */
  updateCalendarEvent(eventId: number | string, changes: CalendarEventUpdate): Promise<unknown> {
    return calendar.updateCalendarEvent(this, eventId, changes);
  }
  /** IRREVERSIBLE. */
  deleteCalendarEvent(eventId: number | string): Promise<unknown> {
    return calendar.deleteCalendarEvent(this, eventId);
  }

  // --- womensHealth ---
  /** The menstrual-cycle day view for one date. */
  getMenstrualDataForDate(fordate: string | Date): Promise<MenstrualDayView | null> {
    return womensHealth.getMenstrualDataForDate(this, fordate);
  }
  /** Menstrual-cycle calendar data between two dates (Garmin allows up to 91 days). */
  getMenstrualCalendarData(
    startdate: string | Date,
    enddate: string | Date,
  ): Promise<MenstrualCalendarData | null> {
    return womensHealth.getMenstrualCalendarData(this, startdate, enddate);
  }
  /** The last confirmed period as of a date. */
  getMenstrualLastConfirmed(fordate: string | Date): Promise<MenstrualLastConfirmed | null> {
    return womensHealth.getMenstrualLastConfirmed(this, fordate);
  }
  /** A summary of the menstrual cycle containing a date. */
  getMenstrualCycleSummary(fordate: string | Date): Promise<MenstrualCycleSummary | null> {
    return womensHealth.getMenstrualCycleSummary(this, fordate);
  }
  /** Menstrual-cycle reports over the last 1, 6 (the default) or 12 cycles. */
  getMenstrualReports(
    fordate: string | Date,
    numberOfCycles?: number,
    options?: { nextReport?: boolean; reportType?: string; todayCalendarDate?: string | Date },
  ): Promise<MenstrualReports | null> {
    return womensHealth.getMenstrualReports(this, fordate, numberOfCycles, options);
  }
  /** The pregnancy-tracking summary. */
  getPregnancySummary(): Promise<PregnancySummary | null> {
    return womensHealth.getPregnancySummary(this);
  }
  /**
   * Logs a day's cycle-tracking entry (symptoms, moods, flow, notes). Replaces whatever that day
   * already holds; there is no undo. Needs cycle tracking set up in Garmin Connect first.
   */
  updateMenstrualDailyLog(
    calendarDate: string | Date,
    options?: {
      symptoms?: string[];
      moods?: string[];
      flow?: string;
      discharge?: string[];
      sexDrive?: string;
      sexualActivity?: string;
      notes?: string;
      ovulationDay?: boolean;
    },
  ): Promise<unknown> {
    return womensHealth.updateMenstrualDailyLog(this, calendarDate, options);
  }
  /**
   * Rewrites the period days in a date range. Replaces what the range holds; there is no undo.
   * Needs cycle tracking set up in Garmin Connect first.
   */
  updateMenstrualCalendar(
    startdate: string | Date,
    enddate: string | Date,
    cycleDatesLists: (string | Date)[][],
    options?: { todayCalendarDate?: string | Date },
  ): Promise<unknown> {
    return womensHealth.updateMenstrualCalendar(this, startdate, enddate, cycleDatesLists, options);
  }
  /**
   * Sets up cycle tracking from a first period start date and average period and cycle lengths.
   * Account-level and not undoable; not meant for an account that is already set up.
   */
  initMenstrualCycleSetup(
    periodStartDate: string | Date,
    periodLength: number,
    cycleLength: number,
  ): Promise<unknown> {
    return womensHealth.initMenstrualCycleSetup(this, periodStartDate, periodLength, cycleLength);
  }
  /**
   * Confirms that a period started on a date, with its period and cycle lengths. There is no
   * undo. Needs cycle tracking set up in Garmin Connect first.
   */
  confirmMenstrualPeriodStart(
    periodStartDate: string | Date,
    periodLength: number,
    cycleLength: number,
    options?: { predictedCycle?: boolean },
  ): Promise<unknown> {
    return womensHealth.confirmMenstrualPeriodStart(
      this,
      periodStartDate,
      periodLength,
      cycleLength,
      options,
    );
  }
  /**
   * Changes cycle-tracking preferences (merged into the current ones). Has no effect until cycle
   * tracking is set up in Garmin Connect.
   */
  updateMenstrualSettings(
    settings: Record<string, unknown>,
    options?: { userSettingsId?: number },
  ): Promise<unknown> {
    return womensHealth.updateMenstrualSettings(this, settings, options);
  }

  // --- goals ---
  /**
   * The account's goals with a given status (active, future or past), every page fetched.
   * Sends the `Sec-Fetch-Site: same-origin` header Garmin needs to return newer goal types.
   */
  getGoals(status?: GoalStatus, start?: number, limit?: number): Promise<Goal[]> {
    return goals.getGoals(this, status, start, limit);
  }

  // --- golf ---
  /** A page of golf scorecard summaries. */
  getGolfSummary(start?: number, limit?: number): Promise<GolfScorecardSummary | null> {
    return golf.getGolfSummary(this, start, limit);
  }
  /** One golf scorecard in full. */
  getGolfScorecard(scorecardId: number | string): Promise<GolfScorecardDetail | null> {
    return golf.getGolfScorecard(this, scorecardId);
  }
  /** Shot data for a scorecard, optionally for some holes only (e.g. `"1,2,3"`). */
  getGolfShotData(
    scorecardId: number | string,
    holeNumbers?: string,
  ): Promise<GolfShotData | null> {
    return golf.getGolfShotData(this, scorecardId, holeNumbers);
  }
  /** Per-club golf stats. */
  getGolfClubStats(limit?: number): Promise<GolfClubStats[] | null> {
    return golf.getGolfClubStats(this, limit);
  }
  /** Golf handicap and strokes-gained overview. */
  getGolfUserStats(): Promise<GolfUserStats | null> {
    return golf.getGolfUserStats(this);
  }

  // --- nutrition ---
  /** The food log for one date. */
  getNutritionDailyFoodLog(cdate: string | Date): Promise<NutritionDailyFoodLog | null> {
    return nutrition.getNutritionDailyFoodLog(this, cdate);
  }
  /** Meals logged on one date. */
  getNutritionDailyMeals(cdate: string | Date): Promise<NutritionDailyMeals | null> {
    return nutrition.getNutritionDailyMeals(this, cdate);
  }
  /** Nutrition settings and goals in effect on one date. */
  getNutritionDailySettings(cdate: string | Date): Promise<NutritionDailySettings | null> {
    return nutrition.getNutritionDailySettings(this, cdate);
  }
  /** Daily food logs over a range; works without Connect+. */
  getNutritionFoodLogRange(
    startdate: string | Date,
    enddate: string | Date,
  ): Promise<NutritionFoodLogRange | null> {
    return nutrition.getNutritionFoodLogRange(this, startdate, enddate);
  }
  /** Food catalogue search. Needs Garmin Connect+. */
  searchFoods(query: string, start?: number, limit?: number): Promise<FoodSearchResult | null> {
    return nutrition.searchFoods(this, query, start, limit);
  }
  /** Your custom foods, optionally filtered by name (limit <= 20). Needs Connect+. */
  getCustomFoods(search?: string, start?: number, limit?: number): Promise<CustomFoodList | null> {
    return nutrition.getCustomFoods(this, search, start, limit);
  }
  /** Serving units a custom food can use. Needs Connect+. */
  getCustomFoodServingUnits(): Promise<{ servingUnits: { name: string }[] } | null> {
    return nutrition.getCustomFoodServingUnits(this);
  }
  /** Creates a custom food (per serving). Needs Connect+. */
  createCustomFood(input: CustomFoodInput): Promise<Food | null> {
    return nutrition.createCustomFood(this, input);
  }
  /** FULL REPLACE of a custom food's definition. Needs Connect+. */
  updateCustomFood(
    foodId: string,
    servingId: string,
    input: CustomFoodInput,
  ): Promise<Food | null> {
    return nutrition.updateCustomFood(this, foodId, servingId, input);
  }
  /** IRREVERSIBLE. Needs Connect+. */
  deleteCustomFood(foodId: string): Promise<unknown> {
    return nutrition.deleteCustomFood(this, foodId);
  }
  /** Logs a catalogue or custom food into a meal. Needs Connect+. */
  logFood(input: FoodLogInput): Promise<NutritionDailyFoodLog | null> {
    return nutrition.logFood(this, input);
  }
  /** Logs an entry by name and macros ("Quick Add"). Needs Connect+. */
  quickAddFood(input: QuickAddInput): Promise<NutritionDailyFoodLog | null> {
    return nutrition.quickAddFood(this, input);
  }
  /** Deletes log entries from one day, any number at once. IRREVERSIBLE. */
  deleteFoodLogs(date: string | Date, logIds: string[]): Promise<unknown> {
    return nutrition.deleteFoodLogs(this, date, logIds);
  }

  // --- training plans ---
  /** The account's training plans. */
  getTrainingPlans(): Promise<TrainingPlansResult | null> {
    return trainingPlans.getTrainingPlans(this);
  }
  /** One phased training plan by id. */
  getTrainingPlanById(planId: number | string): Promise<TrainingPlanDetail | null> {
    return trainingPlans.getTrainingPlanById(this, planId);
  }
  /** One adaptive (Garmin Coach) training plan by id. */
  getAdaptiveTrainingPlanById(planId: number | string): Promise<AdaptiveTrainingPlanDetail | null> {
    return trainingPlans.getAdaptiveTrainingPlanById(this, planId);
  }
  /** Quits an enrolled plan ("Quit Plan"); its workouts leave the calendar. IRREVERSIBLE. */
  deleteTrainingPlan(planId: number | string): Promise<unknown> {
    return trainingPlans.deleteTrainingPlan(this, planId);
  }

  // --- misc ---
  /** Lifestyle logging entries for one date. */
  getLifestyleLoggingData(cdate: string | Date): Promise<LifestyleLoggingData | null> {
    return misc.getLifestyleLoggingData(this, cdate);
  }
  /** Asks Garmin to reload a day's wellness data that it has offloaded. */
  requestReload(cdate: string | Date): Promise<ReloadRequestResult | null> {
    return misc.requestReload(this, cdate);
  }
  /** Sends a GraphQL request body to Garmin's GraphQL gateway verbatim. */
  queryGarminGraphql(query: Record<string, unknown>): Promise<GraphqlResult | null> {
    return misc.queryGarminGraphql(this, query);
  }
  /** Clears the configured `TokenStore`. Makes no request: the token is not revoked server-side. */
  logout(): Promise<void> {
    return misc.logout(this);
  }
}
