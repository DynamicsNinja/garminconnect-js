import type { GarminClient } from "./client.js";
import { GarminError } from "./errors.js";
import * as activities from "./services/activities.js";
import * as badges from "./services/badges.js";
import * as bodyComposition from "./services/bodyComposition.js";
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
import type { ActivityDownloadFormat, ActivityExerciseSets } from "./types/activities.js";
import type { GoalStatus } from "./types/goals.js";
import type { WorkoutInput } from "./types/workouts.js";
import type { WeightScaleFields } from "./util/fit.js";

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

  // --- userProfile ---
  /**
   * Upstream `get_userprofile_settings` — `/userprofile-service/userprofile/settings` (SINGULAR
   * "settings", distinct from `getUserSettings()`'s "user-settings"). Upstream's `get_user_profile`,
   * `get_full_name`, and `get_unit_system` are NOT ported as separate methods here: they map onto
   * this port's pre-existing `getUserSettings()`, `fullName()`, and `unitSystem()` respectively —
   * see the file-level comment in `src/services/userProfile.ts` for the full ruling.
   */
  getUserprofileSettings() {
    return userProfile.getUserprofileSettings(this);
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
  uploadActivity(file: Blob, filename: string) {
    return activities.uploadActivity(this, file, filename);
  }
  getPersonalRecord() {
    return activities.getPersonalRecord(this);
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

  // --- gear ---
  getGear(userProfileNumber: number | string) {
    return gear.getGear(this, userProfileNumber);
  }
  createGear(
    gearType: string,
    brand: string,
    model: string,
    name: string,
    firstUseDate: string | Date,
    usageType?: string,
    maxUsageDistanceKm?: number,
    maxUsageDurationMin?: number,
    notes?: string,
    activityTypeKeys?: string[],
  ) {
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
  getGearStats(gearUUID: string) {
    return gear.getGearStats(this, gearUUID);
  }
  /**
   * NOT upstream parity — upstream has no delete-gear method. Endpoint discovered by observing
   * Garmin's own web client; see `src/services/gear.ts`. IRREVERSIBLE.
   */
  deleteGear(gearUUID: string) {
    return gear.deleteGear(this, gearUUID);
  }
  /**
   * NOT upstream parity — a working replacement for `setGearDefault`, whose upstream endpoint is
   * dead. Uses the v2 full-record PUT Garmin's own web client uses. See `src/services/gear.ts`.
   */
  setGearActivityDefaults(gearUUID: string, activityTypeKeys: string[]) {
    return gear.setGearActivityDefaults(this, gearUUID, activityTypeKeys);
  }
  getGearDefaults(userProfileNumber: number | string) {
    return gear.getGearDefaults(this, userProfileNumber);
  }
  setGearDefault(activityType: string, gearUUID: string, defaultGear?: boolean) {
    return gear.setGearDefault(this, activityType, gearUUID, defaultGear);
  }

  // --- devices ---
  getDevices() {
    return devices.getDevices(this);
  }
  getDeviceSettings(deviceId: number | string) {
    return devices.getDeviceSettings(this, deviceId);
  }
  getPrimaryTrainingDevice() {
    return devices.getPrimaryTrainingDevice(this);
  }
  getDeviceSolarData(deviceId: number | string, startdate: string | Date, enddate?: string | Date) {
    return devices.getDeviceSolarData(this, deviceId, startdate, enddate);
  }
  getDeviceAlarms() {
    return devices.getDeviceAlarms(this);
  }
  getDeviceLastUsed() {
    return devices.getDeviceLastUsed(this);
  }

  // --- badges & challenges ---
  getEarnedBadges() {
    return badges.getEarnedBadges(this);
  }
  getAvailableBadges() {
    return badges.getAvailableBadges(this);
  }
  getInProgressBadges() {
    return badges.getInProgressBadges(this);
  }
  getAdhocChallenges(start: number, limit: number) {
    return badges.getAdhocChallenges(this, start, limit);
  }
  getBadgeChallenges(start: number, limit: number) {
    return badges.getBadgeChallenges(this, start, limit);
  }
  getAvailableBadgeChallenges(start: number, limit: number) {
    return badges.getAvailableBadgeChallenges(this, start, limit);
  }
  getNonCompletedBadgeChallenges(start: number, limit: number) {
    return badges.getNonCompletedBadgeChallenges(this, start, limit);
  }
  getInprogressVirtualChallenges(start: number, limit: number) {
    return badges.getInprogressVirtualChallenges(this, start, limit);
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
  addWeighInWithTimestamps(
    weightValue: number,
    unitKey?: "kg" | "lbs",
    dateTimestamp?: string,
    gmtTimestamp?: string,
    when?: Date,
  ) {
    return weight.addWeighInWithTimestamps(
      this,
      weightValue,
      unitKey,
      dateTimestamp,
      gmtTimestamp,
      when,
    );
  }
  getDailyWeighIns(cdate: string | Date) {
    return weight.getDailyWeighIns(this, cdate);
  }
  /** Irreversible — see `src/services/weight.ts` for the multi-entry/`deleteAll` semantics. */
  deleteWeighIns(cdate: string | Date, deleteAll?: boolean) {
    return weight.deleteWeighIns(this, cdate, deleteAll);
  }

  // --- bodyComposition ---
  getBodyComposition(startdate: string | Date, enddate?: string | Date) {
    return bodyComposition.getBodyComposition(this, startdate, enddate);
  }
  /**
   * `add_body_composition` is UNCERTAIN in the inventory — see
   * `src/services/bodyComposition.ts` for what was (and wasn't) resolved by
   * reading upstream's `fit.py` directly.
   */
  addBodyComposition(weight: number, extra?: WeightScaleFields & { timestamp?: string }) {
    return bodyComposition.addBodyComposition(this, weight, extra);
  }

  // --- metrics ---
  getMaxMetrics(cdate: string | Date) {
    return metrics.getMaxMetrics(this, cdate);
  }
  getMaxMetricsRange(start: string | Date, end: string | Date) {
    return metrics.getMaxMetricsRange(this, start, end);
  }
  getFunctionalThresholdPowerRange(
    start: string | Date,
    end: string | Date,
    sport?: string,
    aggregation?: string,
  ) {
    return metrics.getFunctionalThresholdPowerRange(this, start, end, sport, aggregation);
  }
  getLactateThreshold(
    latest?: boolean,
    startDate?: string | Date,
    endDate?: string | Date,
    aggregation?: string,
  ) {
    return metrics.getLactateThreshold(this, latest, startDate, endDate, aggregation);
  }
  getTrainingReadiness(cdate: string | Date) {
    return metrics.getTrainingReadiness(this, cdate);
  }
  getMorningTrainingReadiness(cdate: string | Date) {
    return metrics.getMorningTrainingReadiness(this, cdate);
  }
  getEnduranceScore(startdate: string | Date, enddate?: string | Date) {
    return metrics.getEnduranceScore(this, startdate, enddate);
  }
  getRunningTolerance(startdate: string | Date, enddate: string | Date, aggregation?: string) {
    return metrics.getRunningTolerance(this, startdate, enddate, aggregation);
  }
  getRacePredictions(
    startdate?: string | Date,
    enddate?: string | Date,
    type?: "daily" | "monthly",
  ) {
    return metrics.getRacePredictions(this, startdate, enddate, type);
  }
  getTrainingStatus(cdate: string | Date) {
    return metrics.getTrainingStatus(this, cdate);
  }
  getFitnessAgeData(cdate: string | Date) {
    return metrics.getFitnessAgeData(this, cdate);
  }
  getHillScore(startdate: string | Date, enddate?: string | Date) {
    return metrics.getHillScore(this, startdate, enddate);
  }
  getCyclingFtp() {
    return metrics.getCyclingFtp(this);
  }
  getHeartRateZones() {
    return metrics.getHeartRateZones(this);
  }
  getPowerZones() {
    return metrics.getPowerZones(this);
  }
  getPowerZonesForSport(sport: string) {
    return metrics.getPowerZonesForSport(this, sport);
  }

  // --- workouts ---
  getWorkouts(start?: number, limit?: number) {
    return workouts.getWorkouts(this, start, limit);
  }
  getWorkoutById(workoutId: number | string) {
    return workouts.getWorkoutById(this, workoutId);
  }
  deleteWorkout(workoutId: number | string) {
    return workouts.deleteWorkout(this, workoutId);
  }
  downloadWorkout(workoutId: number | string) {
    return workouts.downloadWorkout(this, workoutId);
  }
  uploadWorkout(workoutJson: Record<string, unknown> | unknown[] | string) {
    return workouts.uploadWorkout(this, workoutJson);
  }
  updateWorkout(workoutId: number | string, workoutJson: Record<string, unknown> | string) {
    return workouts.updateWorkout(this, workoutId, workoutJson);
  }
  uploadRunningWorkout(workout: WorkoutInput) {
    return workouts.uploadRunningWorkout(this, workout);
  }
  uploadCyclingWorkout(workout: WorkoutInput) {
    return workouts.uploadCyclingWorkout(this, workout);
  }
  uploadSwimmingWorkout(workout: WorkoutInput) {
    return workouts.uploadSwimmingWorkout(this, workout);
  }
  uploadWalkingWorkout(workout: WorkoutInput) {
    return workouts.uploadWalkingWorkout(this, workout);
  }
  uploadHikingWorkout(workout: WorkoutInput) {
    return workouts.uploadHikingWorkout(this, workout);
  }
  uploadStrengthWorkout(workout: WorkoutInput) {
    return workouts.uploadStrengthWorkout(this, workout);
  }
  pushWorkoutToDevice(workoutId?: number | string, deviceId?: number | string) {
    return workouts.pushWorkoutToDevice(this, workoutId, deviceId);
  }
  getScheduledWorkouts(year: number | string, month: number | string) {
    return workouts.getScheduledWorkouts(this, year, month);
  }
  getScheduledWorkoutById(scheduledWorkoutId: number | string) {
    return workouts.getScheduledWorkoutById(this, scheduledWorkoutId);
  }
  getNextScheduledWorkout() {
    return workouts.getNextScheduledWorkout(this);
  }
  scheduleWorkout(workoutId: number | string, dateStr: string | Date) {
    return workouts.scheduleWorkout(this, workoutId, dateStr);
  }
  unscheduleWorkout(scheduledWorkoutId: number | string) {
    return workouts.unscheduleWorkout(this, scheduledWorkoutId);
  }

  // --- womensHealth ---
  getMenstrualDataForDate(fordate: string | Date) {
    return womensHealth.getMenstrualDataForDate(this, fordate);
  }
  getMenstrualCalendarData(startdate: string | Date, enddate: string | Date) {
    return womensHealth.getMenstrualCalendarData(this, startdate, enddate);
  }
  getMenstrualLastConfirmed(fordate: string | Date) {
    return womensHealth.getMenstrualLastConfirmed(this, fordate);
  }
  getMenstrualCycleSummary(fordate: string | Date) {
    return womensHealth.getMenstrualCycleSummary(this, fordate);
  }
  getMenstrualReports(
    fordate: string | Date,
    numberOfCycles?: number,
    options?: { nextReport?: boolean; reportType?: string; todayCalendarDate?: string | Date },
  ) {
    return womensHealth.getMenstrualReports(this, fordate, numberOfCycles, options);
  }
  getPregnancySummary() {
    return womensHealth.getPregnancySummary(this);
  }
  /**
   * Irreversible write to real health data. NOT live-verified — see the file-level comment at the
   * top of `src/services/womensHealth.ts` for why this must never be executed against a live
   * account.
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
  ) {
    return womensHealth.updateMenstrualDailyLog(this, calendarDate, options);
  }
  /**
   * Irreversible write to real health data. NOT live-verified — see the file-level comment at the
   * top of `src/services/womensHealth.ts` for why this must never be executed against a live
   * account.
   */
  updateMenstrualCalendar(
    startdate: string | Date,
    enddate: string | Date,
    cycleDatesLists: (string | Date)[][],
    options?: { todayCalendarDate?: string | Date },
  ) {
    return womensHealth.updateMenstrualCalendar(this, startdate, enddate, cycleDatesLists, options);
  }
  /**
   * Irreversible write to real health data (account-level cycle-tracking setup). NOT
   * live-verified — see the file-level comment at the top of `src/services/womensHealth.ts` for
   * why this must never be executed against a live account.
   */
  initMenstrualCycleSetup(periodStartDate: string | Date, periodLength: number, cycleLength: number) {
    return womensHealth.initMenstrualCycleSetup(this, periodStartDate, periodLength, cycleLength);
  }
  /**
   * Irreversible write to real health data. NOT live-verified — see the file-level comment at the
   * top of `src/services/womensHealth.ts` for why this must never be executed against a live
   * account.
   */
  confirmMenstrualPeriodStart(
    periodStartDate: string | Date,
    periodLength: number,
    cycleLength: number,
    options?: { predictedCycle?: boolean },
  ) {
    return womensHealth.confirmMenstrualPeriodStart(
      this,
      periodStartDate,
      periodLength,
      cycleLength,
      options,
    );
  }
  /**
   * Irreversible write to real health data (account-level tracking-preference flags). NOT
   * live-verified — see the file-level comment at the top of `src/services/womensHealth.ts` for
   * why this must never be executed against a live account.
   */
  updateMenstrualSettings(settings: Record<string, unknown>, options?: { userSettingsId?: number }) {
    return womensHealth.updateMenstrualSettings(this, settings, options);
  }

  // --- goals ---
  /**
   * Upstream `get_goals`. Paginated (see `src/services/goals.ts` for the loop, matching
   * `getActivitiesByDate`'s pattern) and sends the load-bearing `Sec-Fetch-Site: same-origin`
   * header on every request — without it `goal-service` silently returns `[]` for newer
   * accumulation-goal types.
   */
  getGoals(status?: GoalStatus, start?: number, limit?: number) {
    return goals.getGoals(this, status, start, limit);
  }

  // --- golf ---
  getGolfSummary(start?: number, limit?: number) {
    return golf.getGolfSummary(this, start, limit);
  }
  getGolfScorecard(scorecardId: number | string) {
    return golf.getGolfScorecard(this, scorecardId);
  }
  getGolfShotData(scorecardId: number | string, holeNumbers?: string) {
    return golf.getGolfShotData(this, scorecardId, holeNumbers);
  }
  getGolfClubStats(limit?: number) {
    return golf.getGolfClubStats(this, limit);
  }
  getGolfUserStats() {
    return golf.getGolfUserStats(this);
  }

  // --- nutrition ---
  getNutritionDailyFoodLog(cdate: string | Date) {
    return nutrition.getNutritionDailyFoodLog(this, cdate);
  }
  getNutritionDailyMeals(cdate: string | Date) {
    return nutrition.getNutritionDailyMeals(this, cdate);
  }
  getNutritionDailySettings(cdate: string | Date) {
    return nutrition.getNutritionDailySettings(this, cdate);
  }

  // --- training plans ---
  getTrainingPlans() {
    return trainingPlans.getTrainingPlans(this);
  }
  getTrainingPlanById(planId: number | string) {
    return trainingPlans.getTrainingPlanById(this, planId);
  }
  getAdaptiveTrainingPlanById(planId: number | string) {
    return trainingPlans.getAdaptiveTrainingPlanById(this, planId);
  }

  // --- misc ---
  getLifestyleLoggingData(cdate: string | Date) {
    return misc.getLifestyleLoggingData(this, cdate);
  }
  requestReload(cdate: string | Date) {
    return misc.requestReload(this, cdate);
  }
  queryGarminGraphql(query: Record<string, unknown>) {
    return misc.queryGarminGraphql(this, query);
  }
  logout() {
    return misc.logout(this);
  }
}
