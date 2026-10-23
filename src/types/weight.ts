import type { UserGoalsRangeDTO, WeightRangeDTO } from "../generated/personal-api.js";

/**
 * `getWeightGoals`' response: the weight goals in effect over a range (`userGoals`, values in
 * GRAMS) and, for pregnancy tracking, weekly target ranges (`userGoalRanges`).
 * `PersonalApi.UserGoalsRangeDTO`.
 */
export interface WeightGoals extends UserGoalsRangeDTO {}

/**
 * `getWeighIns`' response: per-day summaries and the range's averages. Weights are GRAMS. Fields
 * from Garmin's Personal API spec (`PersonalApi.WeightRangeDTO`).
 */
export interface WeighInRange extends WeightRangeDTO {}

/** One entry of `dateWeightList` on `getDailyWeighIns`'s response. */
export interface WeighInEntry {
  samplePk?: number;
  date?: number;
  calendarDate?: string;
  weight?: number;
  bmi?: number;
  bodyFat?: number;
  bodyWater?: number;
  boneMass?: number;
  muscleMass?: number;
  physiqueRating?: number;
  visceralFat?: number;
  metabolicAge?: number;
  sourceType?: string;
  timestampGMT?: number;
  weightDelta?: number;
  [key: string]: unknown;
}

/** Response of `GET /weight-service/weight/dayview/{cdate}`. */
export interface DailyWeighIns {
  dateWeightList?: WeighInEntry[];
  totalAverage?: Record<string, unknown>;
  [key: string]: unknown;
}
