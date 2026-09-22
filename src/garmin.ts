import type { GarminClient } from "./client.js";
import { GarminError } from "./errors.js";
import * as activities from "./services/activities.js";
import * as weight from "./services/weight.js";
import * as wellness from "./services/wellness.js";
import type { ActivityDownloadFormat } from "./types/activities.js";

export interface SocialProfile {
  displayName: string;
  userName: string;
  fullName: string;
  profileId: number;
  [key: string]: unknown;
}

/** Response of `/userprofile-service/userprofile/user-settings`. */
export interface UserSettings {
  id?: number;
  userData?: {
    measurementSystem?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export class Garmin {
  #profile: Promise<SocialProfile> | null = null;
  #settings: Promise<UserSettings> | null = null;

  constructor(readonly client: GarminClient) {}

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

  async displayName(): Promise<string> {
    return (await this.getUserProfile()).displayName;
  }

  async fullName(): Promise<string> {
    return (await this.getUserProfile()).fullName;
  }

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

  // --- wellness ---
  getUserSummary(cdate: string | Date) {
    return wellness.getUserSummary(this, cdate);
  }
  /** Alias kept for parity with python-garminconnect's get_stats. */
  getStats(cdate: string | Date) {
    return wellness.getUserSummary(this, cdate);
  }
  getStepsData(cdate: string | Date) {
    return wellness.getStepsData(this, cdate);
  }
  getHeartRates(cdate: string | Date) {
    return wellness.getHeartRates(this, cdate);
  }
  getSleepData(cdate: string | Date) {
    return wellness.getSleepData(this, cdate);
  }
  getHrvData(cdate: string | Date) {
    return wellness.getHrvData(this, cdate);
  }
  getBodyBattery(startdate: string | Date, enddate?: string | Date) {
    return wellness.getBodyBattery(this, startdate, enddate);
  }

  // --- activities ---
  getActivities(start?: number, limit?: number) {
    return activities.getActivities(this, start, limit);
  }
  getActivity(activityId: number | string) {
    return activities.getActivity(this, activityId);
  }
  downloadActivity(activityId: number | string, format?: ActivityDownloadFormat) {
    return activities.downloadActivity(this, activityId, format);
  }

  // --- weight ---
  getWeighIns(startdate: string | Date, enddate: string | Date) {
    return weight.getWeighIns(this, startdate, enddate);
  }
  addWeighIn(weightValue: number, unitKey?: "kg" | "lbs") {
    return weight.addWeighIn(this, weightValue, unitKey);
  }
  deleteWeighIn(cdate: string | Date, weightPk: number) {
    return weight.deleteWeighIn(this, cdate, weightPk);
  }
}
