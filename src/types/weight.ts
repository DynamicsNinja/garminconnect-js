export interface WeighInRange {
  dailyWeightSummaries?: Record<string, unknown>[];
  totalAverage?: Record<string, unknown>;
  [key: string]: unknown;
}

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
