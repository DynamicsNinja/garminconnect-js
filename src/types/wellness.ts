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
