/**
 * The write probes `scripts/smoke-writes.ts` does NOT cover — the rows still marked `partially`,
 * `BROKEN` or `attempted` in AGENTS.md section 3.
 *
 *   npm run smoke:gaps
 *
 * Test account only, same unconditional gate as every other write script here. It creates gear,
 * links it, unlinks it and deletes it; it creates workouts and deletes them. Everything it makes,
 * it cleans up — with one honest exception noted at the gear probe.
 *
 * What is here and why:
 *
 *  1. addGearToActivity / removeGearFromActivity SUCCESS path. AGENTS.md contradicts itself: one
 *     gotcha says these are "STILL live-verified only on their 404 path", a later one says the
 *     success path is verified. `smoke-writes.ts` only exercises the 404. This settles it with
 *     fresh evidence rather than by choosing which sentence to believe.
 *  2. setGearActivityDefaults, the working replacement for the removed `setGearDefault`.
 *  3. pushWorkoutToDevice. Expected to fail for want of a paired device; the probe records how far
 *     the multi-step resolution chain gets before it does.
 */
import "./load-env.js";
import { GarminClient, Garmin, FileTokenStore, GarminHttpError } from "../src/index.js";

const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });
if (!(await client.loadTokens())) {
  console.error("No tokens. Run `npm run login` first.");
  process.exit(1);
}
const g = new Garmin(client);

// SAFETY GATE — identical to every other write script here. Not conditional, not skippable.
const expected = process.env["GARMIN_TEST_PROFILE_ID"];
if (!expected) {
  console.error("Refusing to run: GARMIN_TEST_PROFILE_ID is not set. Nothing was written.");
  process.exit(1);
}
const profile = await g.getUserProfile();
if (String(profile.profileId) !== String(expected)) {
  console.error(
    "Refusing to run: live profile does not match the expected test account.\n" +
      `  expected ${expected}, found ${String(profile.profileId)}\nNothing was written.`,
  );
  process.exit(1);
}
console.log(`Safety gate passed: ${String(profile.profileId)}\n`);

type Doc = Record<string, unknown>;
let pass = 0;
let fail = 0;

function report(ok: boolean, label: string, detail: string): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(38)} ${detail}`);
}

function describeError(e: unknown): string {
  return e instanceof GarminHttpError
    ? `HTTP ${String(e.status)} ${e.body.slice(0, 120)}`
    : `${(e as Error).constructor.name}: ${(e as Error).message.slice(0, 160)}`;
}

/** Gear uuids come back without hyphens from `getGear` and with them from `createGear`. */
const bare = (u: string) => u.replace(/-/g, "").toLowerCase();

// =============================================================================================
// 1 + 2. Gear: the link success path, then defaults against that same real gear.
// =============================================================================================
console.log("gear association");
const activity = await g.getLastActivity();
if (activity?.activityId === undefined) {
  report(false, "gear round-trip", "no activity on the test account to link against");
} else {
  let gearUuid: string | undefined;
  try {
    // `firstUseDate` MUST predate the activity or the link 400s — see the gotcha. 2020 is safely
    // before anything this account holds. `notes` must be non-empty (Garmin rejects "").
    const created = (await g.createGear(
      "SHOES",
      "probe",
      "gap-probe",
      `gap-probe ${String(Date.now())}`,
      "2020-01-01",
      "DISTANCE",
      500,
      undefined,
      "created by smoke:gaps, safe to delete",
      ["running"],
    )) as Doc | null;
    gearUuid = typeof created?.["uuid"] === "string" ? (created["uuid"]) : undefined;
    if (gearUuid === undefined) {
      report(false, "createGear", `no uuid in the response: ${JSON.stringify(created).slice(0, 120)}`);
    } else {
      report(true, "createGear (backdated 2020)", "uuid returned");

      // --- addGearToActivity, then READ BACK. A 2xx is not the evidence; the link is. ---------
      await g.addGearToActivity(gearUuid, activity.activityId);
      const linked = (await g.getActivityGear(activity.activityId));
      const isLinked = (linked ?? []).some(
        (x) => typeof x["uuid"] === "string" && bare(x["uuid"]) === bare(gearUuid!),
      );
      report(
        isLinked,
        "addGearToActivity SUCCESS path",
        isLinked
          ? `getActivityGear now lists the gear (${String((linked ?? []).length)} item(s))`
          : `getActivityGear does not list it: ${JSON.stringify(linked).slice(0, 140)}`,
      );

      // --- getGearActivities should now see the activity through the gear --------------------
      const gearActivities = await g.getGearActivities(gearUuid);
      report(
        gearActivities.length > 0,
        "getGearActivities (real gear)",
        `${String(gearActivities.length)} activity/activities`,
      );

      // --- removeGearFromActivity (a PUT, not a DELETE), then READ BACK ----------------------
      await g.removeGearFromActivity(gearUuid, activity.activityId);
      const after = (await g.getActivityGear(activity.activityId));
      const stillThere = (after ?? []).some(
        (x) => typeof x["uuid"] === "string" && bare(x["uuid"]) === bare(gearUuid!),
      );
      report(
        !stillThere,
        "removeGearFromActivity SUCCESS path",
        stillThere ? "still linked after the remove" : "getActivityGear no longer lists it",
      );

      // --- and the working replacement, for contrast in the same run -------------------------
      try {
        await g.setGearActivityDefaults(gearUuid, ["running"]);
        const defaults = (await g.getGearDefaults(profile.profileId));
        const mine = (defaults ?? []).filter(
          (d) => typeof d["uuid"] === "string" && bare(d["uuid"]) === bare(gearUuid!),
        );
        report(
          mine.length > 0,
          "setGearActivityDefaults (replacement)",
          mine.length > 0
            ? `getGearDefaults reflects it (${String(mine.length)} entry/entries)`
            : "getGearDefaults does not reflect it",
        );
      } catch (e) {
        report(false, "setGearActivityDefaults", describeError(e));
      }
    }
  } catch (e) {
    report(false, "gear round-trip", describeError(e));
  } finally {
    if (gearUuid !== undefined) {
      try {
        await g.deleteGear(gearUuid);
        console.log(`  clean  deleted probe gear`);
      } catch (e) {
        console.log(`  WARN   could not delete probe gear: ${describeError(e)}`);
      }
    }
  }
}

// =============================================================================================
// 3. getTrainingPlanById — needs a PHASED plan, which only enrolling one can produce.
// =============================================================================================
// `/trainingplan-service/trainingplan/plans` returns only the account's OWN enrolled plans; it
// cannot browse Garmin's catalogue (probed with and without owner/paging params). So a plan has to
// be enrolled through Garmin Connect's UI before either endpoint can be exercised.
//
// This probe tries EVERY enrolled plan against BOTH endpoints and reports per category, rather
// than filtering for `trainingPlanCategory === "PHASED"`. The earlier version filtered, which is
// how the wrong conclusion survived: a Garmin Coach plan is STATIC and 400s with "Not a phased
// plan.", and that error was read as "the endpoint needs category PHASED". It does not — an ITP
// plan is accepted by BOTH paths. Filtering on a guess hides the evidence that would correct it.
console.log("\ntraining plans");
const plans = (await g.getTrainingPlans()) as {
  trainingPlanList?: { trainingPlanId?: number; trainingPlanCategory?: string }[];
} | null;
const enrolled = plans?.trainingPlanList ?? [];
if (enrolled.length === 0) {
  console.log(
    `  SKIP  ${"getTrainingPlanById".padEnd(38)} no plan enrolled. Enrol one in ` +
      "Training & Planning, then re-run.",
  );
}
for (const plan of enrolled) {
  const id = plan.trainingPlanId;
  const cat = String(plan.trainingPlanCategory);
  if (id === undefined) continue;
  for (const [label, call] of [
    ["getTrainingPlanById", () => g.getTrainingPlanById(id)],
    ["getAdaptiveTrainingPlanById", () => g.getAdaptiveTrainingPlanById(id)],
  ] as const) {
    try {
      const detail = await call();
      report(detail !== null, `${label} [${cat}]`, `${String(Object.keys(detail ?? {}).length)} keys`);
    } catch (e) {
      // A category the endpoint genuinely does not serve is information, not a harness failure —
      // STATIC answering "Not a phased plan." is the documented behaviour of that path.
      console.log(`  NOTE  ${`${label} [${cat}]`.padEnd(38)} ${describeError(e)}`);
    }
  }
}

// =============================================================================================
// 4. pushWorkoutToDevice — expected to fail; the value is in WHERE it fails.
// =============================================================================================
console.log("\ndevice push");
try {
  const pushed = await g.pushWorkoutToDevice();
  report(true, "pushWorkoutToDevice", `ACCEPTED: ${JSON.stringify(pushed).slice(0, 140)}`);
} catch (e) {
  // Not a library failure — the account genuinely has no paired device. What the message tells a
  // future reader is WHERE the chain stops: `mylastused` yields no usable `userDeviceId`, so the
  // final POST goes out with device id 0 and Garmin answers "Device id 0 is not registered."
  // Every step before that one is therefore exercised.
  console.log(`  NOTE  ${"pushWorkoutToDevice".padEnd(38)} ${describeError(e)}`);
}

// =============================================================================================
// 5. Courses — all eight methods, by create -> read back -> update -> read back -> delete.
// =============================================================================================
// A new course is processed in the background; until that finishes, PUT and DELETE answer 429
// "not yet ready". The pause before each is load-bearing. And the track MUST be on land: the first
// version of this probe used Null Island, where processing never finishes and every PUT 429'd for
// five minutes straight — which read, wrongly, as "updating a course does not work".
console.log("\ncourses");
const pause = () => new Promise((r) => setTimeout(r, 6000));
// ~1 km diagonal across Hyde Park, London — a public park, synthetic track.
const trkpts = Array.from({ length: 13 }, (_, i) => {
  const t = new Date(Date.UTC(2026, 0, 1, 8, 0, i * 30)).toISOString();
  return `<trkpt lat="${(51.505 + i * 0.0006).toFixed(6)}" lon="${(-0.17 + i * 0.0008).toFixed(6)}"><ele>${String(10 + i)}</ele><time>${t}</time></trkpt>`;
}).join("");
const probeGpx = new Blob(
  [
    `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="garminconnect-js smoke:gaps" ` +
      `xmlns="http://www.topografix.com/GPX/1/1"><trk><name>gcjs-probe-course</name><trkseg>${trkpts}</trkseg></trk></gpx>`,
  ],
  { type: "application/octet-stream" },
);
let courseId: number | undefined;
let courseDeleted = false;
try {
  const parsed = await g.importCourseGpx(probeGpx, "gcjs-probe.gpx");
  report(
    parsed.courseId === null && parsed.geoPoints.length > 1,
    "importCourseGpx (saves nothing)",
    `courseId ${String(parsed.courseId)}, ${String(parsed.geoPoints.length)} geoPoints, name "${String(parsed.courseName)}"`,
  );

  await pause();
  const created = await g.createCourseFromGpx(probeGpx, "gcjs-probe.gpx", {
    name: "gcjs probe course",
    activityTypeId: 10,
  });
  courseId = created?.courseId ?? undefined;
  if (courseId === undefined) throw new Error(`createCourseFromGpx returned no courseId`);

  // READ BACK — the stored record, not the POST's echo.
  const stored = await g.getCourse(courseId);
  report(
    stored?.courseName === "gcjs probe course" &&
      stored.rulePK === 2 &&
      stored.activityTypePk === 10 &&
      (stored.distanceMeter ?? 0) > 500,
    "createCourseFromGpx -> getCourse",
    `name "${String(stored?.courseName)}", rulePK ${String(stored?.rulePK)}, ` +
      `activityTypePk ${String(stored?.activityTypePk)}, ${String(stored?.distanceMeter)} m`,
  );

  const listed = await g.listCourses();
  report(
    (listed?.coursesForUser ?? []).some((c) => c.courseId === courseId),
    "listCourses",
    `${String(listed?.coursesForUser.length)} course(s), probe course listed`,
  );

  await pause();
  await g.updateCourse(courseId, { name: "gcjs probe course renamed", privacy: "public" });
  const updated = await g.getCourse(courseId);
  report(
    updated?.courseName === "gcjs probe course renamed" && updated.rulePK === 1,
    "updateCourse -> getCourse",
    `name "${String(updated?.courseName)}", rulePK ${String(updated?.rulePK)} (public is 1)`,
  );

  const gpxBytes = await g.downloadCourseGpx(courseId);
  const head = gpxBytes.subarray(0, 200).toString("utf8");
  report(
    gpxBytes.length > 0 && head.startsWith("<?xml") && head.includes("<gpx"),
    "downloadCourseGpx",
    `${String(gpxBytes.length)} bytes of GPX`,
  );

  await pause();
  await g.deleteCourse(courseId);
  try {
    await g.getCourse(courseId);
    report(false, "deleteCourse", "course still readable after delete");
  } catch (e) {
    courseDeleted = e instanceof GarminHttpError && e.status === 404;
    report(courseDeleted, "deleteCourse -> getCourse 404", describeError(e));
  }
} catch (e) {
  report(false, "course round-trip", describeError(e));
} finally {
  if (courseId !== undefined && !courseDeleted) {
    try {
      await pause();
      await g.deleteCourse(courseId);
      console.log(`  clean  deleted probe course ${String(courseId)}`);
    } catch (e) {
      console.log(`  WARN   could not delete probe course ${String(courseId)}: ${describeError(e)}`);
    }
  }
}

// =============================================================================================
// 6. Activity event type, perceived effort and feel — set, READ BACK via getActivity, restore.
// =============================================================================================
console.log("\nactivity event type / RPE / feel");
{
  const eventTypes = await g.getActivityEventTypes();
  report(
    (eventTypes ?? []).length === 9 && (eventTypes ?? []).some((t) => t.typeKey === "race"),
    "getActivityEventTypes",
    `${String((eventTypes ?? []).length)} types: ${(eventTypes ?? []).map((t) => t.typeKey).join(", ")}`,
  );
  const last = await g.getLastActivity();
  if (last?.activityId === undefined) {
    report(false, "activity fields", "no activity on the test account");
  } else {
    const id = last.activityId;
    type Stored = { eventTypeDTO?: { typeKey?: string }; summaryDTO?: Record<string, unknown> };
    const before = (await g.getActivity(id)) as Stored;
    const originalEvent = before.eventTypeDTO?.typeKey ?? "uncategorized";
    const originalRpe = before.summaryDTO?.["directWorkoutRpe"];
    const originalFeel = before.summaryDTO?.["directWorkoutFeel"];
    try {
      await g.setActivityEventType(id, "race");
      await g.setActivityPerceivedEffort(id, 7);
      await g.setActivityFeel(id, 75);
      const after = (await g.getActivity(id)) as Stored;
      report(after.eventTypeDTO?.typeKey === "race", "setActivityEventType -> getActivity", `typeKey ${String(after.eventTypeDTO?.typeKey)}`);
      report(
        after.summaryDTO?.["directWorkoutRpe"] === 70,
        "setActivityPerceivedEffort(7) -> getActivity",
        `directWorkoutRpe ${String(after.summaryDTO?.["directWorkoutRpe"])} (stored x10)`,
      );
      report(
        after.summaryDTO?.["directWorkoutFeel"] === 75,
        "setActivityFeel(75) -> getActivity",
        `directWorkoutFeel ${String(after.summaryDTO?.["directWorkoutFeel"])}`,
      );
      await g.setActivityPerceivedEffort(id, null);
      await g.setActivityFeel(id, null);
      const cleared = (await g.getActivity(id)) as Stored;
      report(
        cleared.summaryDTO?.["directWorkoutRpe"] == null && cleared.summaryDTO?.["directWorkoutFeel"] == null,
        "RPE and feel cleared with null",
        `rpe ${String(cleared.summaryDTO?.["directWorkoutRpe"])}, feel ${String(cleared.summaryDTO?.["directWorkoutFeel"])}`,
      );
    } catch (e) {
      report(false, "activity fields", describeError(e));
    } finally {
      await g.setActivityEventType(id, originalEvent as "uncategorized");
      await client.connectapi(`/activity-service/activity/${String(id)}`, {
        method: "PUT",
        json: { activityId: id, summaryDTO: { directWorkoutRpe: originalRpe ?? null, directWorkoutFeel: originalFeel ?? null } },
      });
      console.log(`  clean  restored activity ${String(id)} to event "${originalEvent}"`);
    }
  }
}

// =============================================================================================
// 7. Heart-rate zones — change DEFAULT, create + delete a sport profile, restore DEFAULT.
// =============================================================================================
console.log("\nheart-rate zones");
{
  const original = ((await g.getHeartRateZones()) ?? []).find((z) => z.sport === "DEFAULT");
  if (!original) {
    report(false, "heart-rate zones", "no DEFAULT profile to start from");
  } else {
    try {
      const floors = [
        Number(original.zone1Floor) + 1,
        Number(original.zone2Floor) + 1,
        Number(original.zone3Floor) + 1,
        Number(original.zone4Floor) + 1,
        Number(original.zone5Floor) + 1,
      ] as [number, number, number, number, number];
      const stored = await g.setHeartRateZones({ zoneFloors: floors });
      report(
        stored?.zone1Floor === floors[0] && stored.zone5Floor === floors[4],
        "setHeartRateZones(DEFAULT floors)",
        `floors now ${[stored?.zone1Floor, stored?.zone2Floor, stored?.zone3Floor, stored?.zone4Floor, stored?.zone5Floor].join("/")}`,
      );
      const running = await g.setHeartRateZones({ sport: "running", trainingMethod: "HR_RESERVE", restingHeartRate: 55 });
      report(
        running?.sport === "RUNNING" && running.trainingMethod === "HR_RESERVE" && running.restingHeartRateUsed === 55,
        "setHeartRateZones(new RUNNING profile)",
        `sport ${String(running?.sport)}, method ${String(running?.trainingMethod)}, resting ${String(running?.restingHeartRateUsed)}`,
      );
      await g.deleteHeartRateZones("RUNNING");
      const left = (await g.getHeartRateZones()) ?? [];
      report(!left.some((z) => z.sport === "RUNNING"), "deleteHeartRateZones(RUNNING)", `profiles left: ${left.map((z) => String(z.sport)).join(", ")}`);
    } catch (e) {
      report(false, "heart-rate zones", describeError(e));
    } finally {
      const profiles = (await g.getHeartRateZones()) ?? [];
      await client.connectapi("/biometric-service/heartRateZones", {
        method: "PUT",
        json: [
          { ...original, changeState: "CHANGED" },
          ...profiles.filter((z) => z.sport === "RUNNING").map((z) => ({ ...z, changeState: "DELETED" })),
        ],
      });
      const restored = ((await g.getHeartRateZones()) ?? []).find((z) => z.sport === "DEFAULT");
      console.log(
        `  clean  DEFAULT zones restored: ${restored?.zone1Floor === original.zone1Floor && restored?.zone5Floor === original.zone5Floor ? "yes" : "NO — check by hand"}`,
      );
    }
  }
}

// =============================================================================================
// 8. Calendar events — create -> read back -> list -> month feed -> update -> read back -> delete.
// =============================================================================================
console.log("\ncalendar events");
{
  let eventId: number | undefined;
  let eventDeleted = false;
  const eventDate = new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10);
  try {
    const created = await g.createCalendarEvent({
      name: "gcjs probe 10k",
      date: eventDate,
      startTime: "09:30",
      timeZoneId: "America/New_York",
      eventType: "running",
      race: true,
      primary: true,
      distance: { value: 10, unit: "kilometer" },
      goalTimeSeconds: 2700,
      location: "Probe Park",
      note: "created by smoke:gaps, safe to delete",
    });
    eventId = created?.id;
    if (eventId === undefined) throw new Error("createCalendarEvent returned no id");
    const stored = await g.getCalendarEvent(eventId);
    report(
      stored?.eventName === "gcjs probe 10k" &&
        stored.date === eventDate &&
        stored.race === true &&
        stored.completionTarget?.value === 10 &&
        stored.completionTarget.unit === "kilometer" &&
        stored.eventCustomization?.customGoal?.value === 2700 &&
        stored.eventCustomization.isPrimaryEvent === true &&
        stored.eventTimeLocal?.startTimeHhMm === "09:30",
      "createCalendarEvent -> getCalendarEvent",
      `"${String(stored?.eventName)}" ${String(stored?.date)}, ${String(stored?.completionTarget?.value)} ${String(stored?.completionTarget?.unit)}, goal ${String(stored?.eventCustomization?.customGoal?.value)}s, privacy ${String(stored?.eventPrivacy?.label)}`,
    );

    const ranged = await g.listCalendarEvents(eventDate, eventDate);
    const all = await g.listCalendarEvents();
    report(
      (ranged ?? []).some((e) => e.id === eventId) && (all ?? []).some((e) => e.id === eventId),
      "listCalendarEvents (range and all)",
      `range ${String((ranged ?? []).length)}, all ${String((all ?? []).length)}`,
    );

    const [y, m] = eventDate.split("-").map(Number) as [number, number];
    const month = await g.getScheduledWorkouts(y, m);
    report(
      (month?.calendarItems ?? []).some((i) => i.itemType === "event" && i["id"] === eventId),
      "event in the month calendar feed",
      `itemType "event" present: ${String((month?.calendarItems ?? []).some((i) => i["id"] === eventId))}`,
    );

    await g.updateCalendarEvent(eventId, { name: "gcjs probe 10k renamed", note: null, race: false, goalTimeSeconds: 2600 });
    const updated = await g.getCalendarEvent(eventId);
    report(
      updated?.eventName === "gcjs probe 10k renamed" &&
        updated.note == null &&
        updated.race === false &&
        updated.eventCustomization?.customGoal?.value === 2600 &&
        updated.completionTarget?.value === 10,
      "updateCalendarEvent -> getCalendarEvent",
      `"${String(updated?.eventName)}", note ${String(updated?.note)}, race ${String(updated?.race)}, goal ${String(updated?.eventCustomization?.customGoal?.value)}s, distance kept ${String(updated?.completionTarget?.value)}`,
    );

    await g.deleteCalendarEvent(eventId);
    try {
      await g.getCalendarEvent(eventId);
      report(false, "deleteCalendarEvent", "event still readable after delete");
    } catch (e) {
      eventDeleted = e instanceof GarminHttpError && e.status === 404;
      report(eventDeleted, "deleteCalendarEvent -> getCalendarEvent 404", describeError(e));
    }
  } catch (e) {
    report(false, "calendar event round-trip", describeError(e));
  } finally {
    if (eventId !== undefined && !eventDeleted) {
      await g.deleteCalendarEvent(eventId).catch(() => undefined);
      console.log(`  clean  deleted probe event ${String(eventId)}`);
    }
  }
}

// =============================================================================================
// 9. Daily stats and the GraphQL schedule reads.
// =============================================================================================
console.log("\ndaily stats and schedule summaries");
{
  // The test account has no wellness data, so values come back empty; what this proves is that a
  // 70-day range is chunked into requests Garmin accepts (a single one would 400). The row shape
  // is verified read-only on a real account by `npm run smoke:real`.
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 69 * 864e5).toISOString().slice(0, 10);
  for (const type of ["CALORIES", "STEPS"] as const) {
    try {
      const rows = await g.getDailyStats(start, end, type);
      report(Array.isArray(rows), `getDailyStats(${type}, 70 days)`, `${String(rows.length)} day(s), no 400`);
    } catch (e) {
      report(false, `getDailyStats(${type})`, describeError(e));
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  try {
    const plans = await g.getTrainingPlanWorkouts(today);
    const sunday = await g.getTrainingPlanWorkouts(today, { firstDayOfWeek: "sunday" });
    const first = plans[0];
    const enrolled = (await g.getTrainingPlans())?.trainingPlanList ?? [];
    if (enrolled.length === 0) {
      console.log(`  SKIP  ${"getTrainingPlanWorkouts".padEnd(38)} no plan enrolled (returned ${String(plans.length)}, as it should)`);
    } else report(
      plans.length > 0 && (first?.workoutScheduleSummaries.length ?? 0) > 0 && sunday.length > 0,
      "getTrainingPlanWorkouts",
      `${String(plans.length)} plan(s); "${String(first?.planName)}" ${String(first?.trainingPlanClassification)}, ${String(first?.workoutScheduleSummaries.length)} workout(s)`,
    );
  } catch (e) {
    report(false, "getTrainingPlanWorkouts", describeError(e));
  }

  // Schedule one of our own workouts, find it among the summaries, unschedule it through the
  // summary's scheduledWorkoutId, and delete the workout.
  let workoutId: number | undefined;
  const scheduleDate = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
  try {
    const uploaded = await g.uploadRunningWorkout({
      workoutName: "gcjs probe schedule",
      estimatedDurationInSecs: 600,
      workoutSegments: [
        {
          segmentOrder: 1,
          sportType: { sportTypeId: 1, sportTypeKey: "running", displayOrder: 1 },
          workoutSteps: [
            {
              type: "ExecutableStepDTO",
              stepOrder: 1,
              stepType: { stepTypeId: 3, stepTypeKey: "interval", displayOrder: 3 },
              endCondition: { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true },
              endConditionValue: 600,
              targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 },
            },
          ],
        },
      ],
    });
    workoutId = typeof uploaded?.["workoutId"] === "number" ? uploaded["workoutId"] : undefined;
    if (workoutId === undefined) throw new Error("uploadRunningWorkout returned no workoutId");
    await g.scheduleWorkout(workoutId, scheduleDate);
    // The GraphQL summaries lag the write by a few seconds (0 at once, 1 after 10s, on
    // 2026-10-06), while the month feed has it immediately. Poll rather than read once.
    let summaries: Awaited<ReturnType<typeof g.getScheduledWorkoutSummaries>> = [];
    let waited = 0;
    for (; waited <= 60; waited += 5) {
      summaries = await g.getScheduledWorkoutSummaries(scheduleDate, scheduleDate);
      if (summaries.some((s) => s.workoutId === workoutId)) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    const ours = summaries.find((s) => s.workoutId === workoutId);
    report(
      ours !== undefined && ours.scheduleDate === scheduleDate && ours.workoutName === "gcjs probe schedule",
      "getScheduledWorkoutSummaries",
      ours
        ? `found after ~${String(waited)}s, scheduledWorkoutId ${String(ours.scheduledWorkoutId)}, tpType ${String(ours.tpType)}, workoutType ${String(ours.workoutType)}`
        : `not among ${String(summaries.length)} summaries after 60s`,
    );
    if (ours?.scheduledWorkoutId != null) {
      await g.unscheduleWorkout(ours.scheduledWorkoutId);
      let gone = false;
      for (let i = 0; i <= 12 && !gone; i++) {
        const after = await g.getScheduledWorkoutSummaries(scheduleDate, scheduleDate);
        gone = !after.some((s) => s.workoutId === workoutId);
        if (!gone) await new Promise((r) => setTimeout(r, 5000));
      }
      report(gone, "unscheduleWorkout(summary id)", gone ? "gone from the summaries" : "still listed after 60s");
    }
  } catch (e) {
    report(false, "schedule summaries round-trip", describeError(e));
  } finally {
    if (workoutId !== undefined) {
      await g.deleteWorkout(workoutId).catch(() => undefined);
      console.log(`  clean  deleted probe workout ${String(workoutId)}`);
    }
  }
}

console.log(`\n${String(pass)} passed, ${String(fail)} failed.`);
