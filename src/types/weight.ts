export interface WeighInRange {
  dailyWeightSummaries?: Record<string, unknown>[];
  totalAverage?: Record<string, unknown>;
  [key: string]: unknown;
}
