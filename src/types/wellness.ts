export interface UserSummary {
  totalSteps?: number;
  totalDistanceMeters?: number;
  activeKilocalories?: number;
  privacyProtected?: boolean;
  [key: string]: unknown;
}

export interface StepsEntry {
  startGMT?: string;
  endGMT?: string;
  steps?: number;
  primaryActivityLevel?: string;
  [key: string]: unknown;
}

export interface HeartRateData {
  restingHeartRate?: number;
  maxHeartRate?: number;
  minHeartRate?: number;
  heartRateValues?: [number, number | null][];
  [key: string]: unknown;
}

export interface SleepData {
  dailySleepDTO?: Record<string, unknown>;
  sleepLevels?: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface HrvData {
  hrvSummary?: Record<string, unknown>;
  hrvReadings?: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface BodyBatteryEntry {
  date?: string;
  charged?: number;
  drained?: number;
  [key: string]: unknown;
}

export interface FloorsData {
  floorValuesArray?: unknown[];
  [key: string]: unknown;
}

export interface DailyStepsEntry {
  calendarDate?: string;
  totalSteps?: number;
  stepGoal?: number;
  [key: string]: unknown;
}

export interface WeeklyStepsEntry {
  calendarDate?: string;
  totalSteps?: number;
  [key: string]: unknown;
}

export interface WeeklyStressEntry {
  calendarDate?: string;
  [key: string]: unknown;
}

export interface WeeklyIntensityMinutesEntry {
  calendarDate?: string;
  [key: string]: unknown;
}

/** `getUserSummary`'s fields plus whatever the body-composition `totalAverage` block carries. */
export interface StatsAndBody extends UserSummary {
  [key: string]: unknown;
}

export interface BodyBatteryEvent {
  eventType?: string;
  eventStartTimeGmt?: string;
  [key: string]: unknown;
}

export interface BloodPressureSetResult {
  [key: string]: unknown;
}

export interface BloodPressureRange {
  measurementSummaries?: unknown[];
  [key: string]: unknown;
}

export interface HydrationLogResult {
  [key: string]: unknown;
}

export interface RespirationData {
  [key: string]: unknown;
}

export interface Spo2Data {
  lastSevenDaysAvgSpO2?: number;
  [key: string]: unknown;
}

export interface IntensityMinutesData {
  [key: string]: unknown;
}

export interface DailyStressData {
  [key: string]: unknown;
}

export interface DailyEventsData {
  [key: string]: unknown;
}

export interface SleepDailyEntry {
  calendarDate?: string;
  [key: string]: unknown;
}

export interface RhrDayData {
  [key: string]: unknown;
}

export interface RhrDailyEntry {
  calendarDate?: string;
  value?: number;
}

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

export interface HrvDataRange {
  [key: string]: unknown;
}
