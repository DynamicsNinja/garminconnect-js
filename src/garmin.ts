import type { GarminClient } from "./client.js";
import { GarminError } from "./errors.js";
import * as activities from "./services/activities.js";
import * as weight from "./services/weight.js";
import * as wellness from "./services/wellness.js";
import type { ActivityDownloadFormat, ActivityExerciseSets } from "./types/activities.js";

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
  getBodyBatteryEvents(cdate: string | Date) {
    return wellness.getBodyBatteryEvents(this, cdate);
  }
  getFloors(cdate: string | Date) {
    return wellness.getFloors(this, cdate);
  }
  getDailySteps(start: string | Date, end: string | Date) {
    return wellness.getDailySteps(this, start, end);
  }
  getWeeklySteps(end: string | Date, weeks?: number) {
    return wellness.getWeeklySteps(this, end, weeks);
  }
  getWeeklyStress(end: string | Date, weeks?: number) {
    return wellness.getWeeklyStress(this, end, weeks);
  }
  getWeeklyIntensityMinutes(start: string | Date, end: string | Date) {
    return wellness.getWeeklyIntensityMinutes(this, start, end);
  }
  getStatsAndBody(cdate: string | Date) {
    return wellness.getStatsAndBody(this, cdate);
  }
  setBloodPressure(
    systolic: number,
    diastolic: number,
    pulse?: number,
    when?: Date,
    notes?: string,
  ) {
    return wellness.setBloodPressure(this, systolic, diastolic, pulse, when, notes);
  }
  getBloodPressure(startdate: string | Date, enddate?: string | Date) {
    return wellness.getBloodPressure(this, startdate, enddate);
  }
  deleteBloodPressure(version: number | string, cdate: string | Date) {
    return wellness.deleteBloodPressure(this, version, cdate);
  }
  addHydrationData(valueInMl: number, when?: Date, cdate?: string | Date) {
    return wellness.addHydrationData(this, valueInMl, when, cdate);
  }
  getHydrationData(cdate: string | Date) {
    return wellness.getHydrationData(this, cdate);
  }
  getRespirationData(cdate: string | Date) {
    return wellness.getRespirationData(this, cdate);
  }
  getSpo2Data(cdate: string | Date) {
    return wellness.getSpo2Data(this, cdate);
  }
  getIntensityMinutesData(cdate: string | Date) {
    return wellness.getIntensityMinutesData(this, cdate);
  }
  getAllDayStress(cdate: string | Date) {
    return wellness.getAllDayStress(this, cdate);
  }
  getStressData(cdate: string | Date) {
    return wellness.getStressData(this, cdate);
  }
  getAllDayEvents(cdate: string | Date) {
    return wellness.getAllDayEvents(this, cdate);
  }
  getSleepDaily(start: string | Date, end: string | Date) {
    return wellness.getSleepDaily(this, start, end);
  }
  getRhrDay(cdate: string | Date) {
    return wellness.getRhrDay(this, cdate);
  }
  getRhrDaily(start: string | Date, end: string | Date) {
    return wellness.getRhrDaily(this, start, end);
  }
  getCaloriesDaily(start: string | Date, end: string | Date) {
    return wellness.getCaloriesDaily(this, start, end);
  }
  getHrvDataRange(start: string | Date, end: string | Date) {
    return wellness.getHrvDataRange(this, start, end);
  }

  // --- activities ---
  countActivities() {
    return activities.countActivities(this);
  }
  getActivities(start?: number, limit?: number) {
    return activities.getActivities(this, start, limit);
  }
  getActivitiesForDate(fordate: string | Date) {
    return activities.getActivitiesForDate(this, fordate);
  }
  getActivitiesByDate(
    startdate: string | Date,
    enddate?: string | Date,
    activitytype?: string,
    sortorder?: string,
  ) {
    return activities.getActivitiesByDate(this, startdate, enddate, activitytype, sortorder);
  }
  getLastActivity() {
    return activities.getLastActivity(this);
  }
  getActivity(activityId: number | string) {
    return activities.getActivity(this, activityId);
  }
  getActivityTypes() {
    return activities.getActivityTypes(this);
  }
  deleteActivity(activityId: number | string) {
    return activities.deleteActivity(this, activityId);
  }
  setActivityName(activityId: number | string, activityName: string) {
    return activities.setActivityName(this, activityId, activityName);
  }
  setActivityType(activityId: number | string, typeId: number, typeKey: string, parentTypeId: number) {
    return activities.setActivityType(this, activityId, typeId, typeKey, parentTypeId);
  }
  setActivityDescription(activityId: number | string, description: string) {
    return activities.setActivityDescription(this, activityId, description);
  }
  createManualActivityFromJson(payload: Record<string, unknown>) {
    return activities.createManualActivityFromJson(this, payload);
  }
  createManualActivity(
    startDatetime: string,
    timeZone: string,
    typeKey: string,
    distanceKm: number,
    durationMin: number,
    activityName: string,
  ) {
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
  importActivity(file: Blob, filename: string) {
    return activities.importActivity(this, file, filename);
  }
  downloadActivity(activityId: number | string, format?: ActivityDownloadFormat) {
    return activities.downloadActivity(this, activityId, format);
  }
  getActivitySplits(activityId: number | string) {
    return activities.getActivitySplits(this, activityId);
  }
  getActivityTypedSplits(activityId: number | string) {
    return activities.getActivityTypedSplits(this, activityId);
  }
  getActivitySplitSummaries(activityId: number | string) {
    return activities.getActivitySplitSummaries(this, activityId);
  }
  getActivityWeather(activityId: number | string) {
    return activities.getActivityWeather(this, activityId);
  }
  getActivityHrInTimezones(activityId: number | string) {
    return activities.getActivityHrInTimezones(this, activityId);
  }
  getActivityPowerInTimezones(activityId: number | string) {
    return activities.getActivityPowerInTimezones(this, activityId);
  }
  getActivityDetails(activityId: number | string, maxchart?: number, maxpoly?: number) {
    return activities.getActivityDetails(this, activityId, maxchart, maxpoly);
  }
  getActivityExerciseSets(activityId: number | string) {
    return activities.getActivityExerciseSets(this, activityId);
  }
  setActivityExerciseSets(activityId: number | string, payload: ActivityExerciseSets) {
    return activities.setActivityExerciseSets(this, activityId, payload);
  }
  getActivityGear(activityId: number | string) {
    return activities.getActivityGear(this, activityId);
  }
  getGearActivities(gearUUID: string, limit?: number) {
    return activities.getGearActivities(this, gearUUID, limit);
  }
  addGearToActivity(gearUUID: string, activityId: number | string) {
    return activities.addGearToActivity(this, gearUUID, activityId);
  }
  removeGearFromActivity(gearUUID: string, activityId: number | string) {
    return activities.removeGearFromActivity(this, gearUUID, activityId);
  }
  getProgressSummaryBetweenDates(
    startdate: string | Date,
    enddate: string | Date,
    metric?: string,
    groupbyactivities?: boolean,
  ) {
    return activities.getProgressSummaryBetweenDates(
      this,
      startdate,
      enddate,
      metric,
      groupbyactivities,
    );
  }
  downloadHealthSnapshot(requestedDate: string | Date) {
    return activities.downloadHealthSnapshot(this, requestedDate);
  }

  // --- weight ---
  getWeighIns(startdate: string | Date, enddate: string | Date) {
    return weight.getWeighIns(this, startdate, enddate);
  }
  addWeighIn(weightValue: number, unitKey?: "kg" | "lbs", when?: Date) {
    return weight.addWeighIn(this, weightValue, unitKey, when);
  }
  deleteWeighIn(cdate: string | Date, weightPk: number) {
    return weight.deleteWeighIn(this, cdate, weightPk);
  }
}
