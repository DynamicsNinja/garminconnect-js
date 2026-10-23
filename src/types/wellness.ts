import type {
  BodyBatteryDailyReportDTO,
  HrvChartDTO,
  HrvDailySummaryDTO,
  StepsDailyStatDTO,
  UserDailySummaryV2DTO,
} from "../generated/personal-api.js";

/** `getUserSummary`'s response: one day's totals. Only a few of its fields are typed. */
export interface UserSummary {
  totalSteps?: number;
  totalDistanceMeters?: number;
  activeKilocalories?: number;
  privacyProtected?: boolean;
  [key: string]: unknown;
}

/** One interval of `getStepsData`'s step series. */
export interface StepsEntry {
  startGMT?: string;
  endGMT?: string;
  steps?: number;
  primaryActivityLevel?: string;
  [key: string]: unknown;
}

/** `getHeartRates`' response. `heartRateValues` holds `[timestampMs, bpm]` pairs. */
export interface HeartRateData {
  restingHeartRate?: number;
  maxHeartRate?: number;
  minHeartRate?: number;
  heartRateValues?: [number, number | null][];
  [key: string]: unknown;
}

/** `getSleepData`'s response: the night's summary (`dailySleepDTO`) and its sleep levels. */
export interface SleepData {
  dailySleepDTO?: Record<string, unknown>;
  sleepLevels?: Record<string, unknown>[];
  [key: string]: unknown;
}

/**
 * `getHrvData`'s response: the day's HRV summary and individual readings. Fields from Garmin's
 * Personal API spec (`PersonalApi.HrvChartDTO`), which matched this endpoint key for key.
 */
export interface HrvData extends HrvChartDTO {}

/**
 * One day of `getBodyBattery`'s reports. Fields from Garmin's Personal API spec
 * (`PersonalApi.BodyBatteryDailyReportDTO`).
 */
export interface BodyBatteryEntry extends BodyBatteryDailyReportDTO {
  date?: string;
  charged?: number;
  drained?: number;
  [key: string]: unknown;
}

/** `getFloors`' response. */
export interface FloorsData {
  floorValuesArray?: unknown[];
  [key: string]: unknown;
}

/** One day of `getDailySteps`. `totalDistance` is meters (`PersonalApi.StepsDailyStatDTO`). */
export interface DailyStepsEntry extends StepsDailyStatDTO {
  calendarDate?: string;
  totalSteps?: number;
  stepGoal?: number;
  [key: string]: unknown;
}

/** One week of `getWeeklySteps`. */
export interface WeeklyStepsEntry {
  calendarDate?: string;
  totalSteps?: number;
  [key: string]: unknown;
}

/** One week of `getWeeklyStress`. */
export interface WeeklyStressEntry {
  calendarDate?: string;
  [key: string]: unknown;
}

/** One week of `getWeeklyIntensityMinutes`. */
export interface WeeklyIntensityMinutesEntry {
  calendarDate?: string;
  [key: string]: unknown;
}

/** `getUserSummary`'s fields plus whatever the body-composition `totalAverage` block carries. */
export interface StatsAndBody extends UserSummary {
  [key: string]: unknown;
}

/** One of `getBodyBatteryEvents`' events. */
export interface BodyBatteryEvent {
  eventType?: string;
  eventStartTimeGmt?: string;
  [key: string]: unknown;
}

/** `setBloodPressure`'s response. */
export interface BloodPressureSetResult {
  [key: string]: unknown;
}

/** `getBloodPressure`'s response; the readings are in `measurementSummaries`. */
export interface BloodPressureRange {
  measurementSummaries?: unknown[];
  [key: string]: unknown;
}

/** The hydration log returned by `getHydrationData` and `addHydrationData`. */
export interface HydrationLogResult {
  [key: string]: unknown;
}

/** `getRespirationData`'s response. */
export interface RespirationData {
  [key: string]: unknown;
}

/** `getSpo2Data`'s response. */
export interface Spo2Data {
  lastSevenDaysAvgSpO2?: number;
  [key: string]: unknown;
}

/** `getIntensityMinutesData`'s response. */
export interface IntensityMinutesData {
  [key: string]: unknown;
}

/** The response of `getAllDayStress` and its alias `getStressData`. */
export interface DailyStressData {
  [key: string]: unknown;
}

/** `getAllDayEvents`' response. */
export interface DailyEventsData {
  [key: string]: unknown;
}

/** One night of `getSleepDaily`. */
export interface SleepDailyEntry {
  calendarDate?: string;
  [key: string]: unknown;
}

/** `getRhrDay`'s response. */
export interface RhrDayData {
  [key: string]: unknown;
}

/** One day of `getRhrDaily`: the resting heart rate in bpm. */
export interface RhrDailyEntry {
  calendarDate?: string;
  value?: number;
}

/** One day of `getCaloriesDaily`: active, resting and total calories. */
export interface CaloriesDailyEntry {
  calendarDate?: string;
  active?: number;
  resting?: number;
  total?: number;
}

/** What `getDailyStats` can fetch. Garmin answers any other `statsType` (lower-case too) with 404. */
export type DailyStatsType = "CALORIES" | "STEPS";

/**
 * One day of `GET /usersummary-service/stats/daily/{start}/{end}?statsType=…`. Read live on
 * 2026-10-06 from a real account: CALORIES days carry `totalCalories`, `activeCalories`,
 * `restingCalories`; STEPS days carry `totalSteps`, `totalDistance` (metres) and `stepGoal`.
 */
export interface DailyStatsEntry {
  calendarDate: string;
  values: {
    totalCalories?: number | null;
    activeCalories?: number | null;
    restingCalories?: number | null;
    totalSteps?: number | null;
    totalDistance?: number | null;
    stepGoal?: number | null;
    [key: string]: unknown;
  };
}

/** `getHrvDataRange`'s response: `hrvSummaries`, one per day (`PersonalApi.HrvDailySummaryDTO`). */
export interface HrvDataRange extends HrvDailySummaryDTO {}

/**
 * One day of `getDailySummaries`: the whole day in one object, grouped by topic (`movement`,
 * `calories`, `heartRate`, `intensityMinutes`, `stress`, `bodyBattery`, `hydration`,
 * `respiration`, `pulseOx`, `jetLag`). Fields from Garmin's Personal API spec
 * (`PersonalApi.UserDailySummaryV2DTO`); a block is missing or sparse when the device does not
 * record it.
 */
export interface DailySummary extends UserDailySummaryV2DTO {
  calendarDate: string;
}
