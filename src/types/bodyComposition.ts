/** Response of `GET /weight-service/weight/dateRange`. */
export interface BodyCompositionRange {
  startDate?: string;
  endDate?: string;
  dailyWeightSummaries?: Record<string, unknown>[];
  totalAverage?: Record<string, unknown>;
  [key: string]: unknown;
}
