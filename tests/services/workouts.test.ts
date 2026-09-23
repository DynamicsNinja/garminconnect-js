import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import type { Tokens } from "../../src/auth/tokens.js";
import type { WorkoutInput } from "../../src/types/workouts.js";

import { WORKOUT_SPORT_TYPE_ID } from "../../src/types/workouts.js";

const API = "https://connectapi.garmin.com";
const seen: { url: string; method: string; body?: unknown }[] = [];

async function record(request: Request): Promise<void> {
  let body: unknown;
  if (request.method !== "GET" && request.method !== "DELETE") {
    body = await request.clone().json();
  }
  seen.push({ url: request.url, method: request.method, body });
}

const baseWorkoutInput: WorkoutInput = {
  workoutName: "Test Workout",
  estimatedDurationInSecs: 1800,
  workoutSegments: [
    {
      segmentOrder: 1,
      sportType: { sportTypeId: 1, sportTypeKey: "running", displayOrder: 1 },
      workoutSteps: [
        {
          type: "ExecutableStepDTO",
          stepOrder: 1,
          stepType: { stepTypeId: 1, stepTypeKey: "warmup", displayOrder: 1 },
          endCondition: { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true },
          endConditionValue: 600,
          targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 },
        },
      ],
    },
  ],
};

const server = setupServer(
  http.get(`${API}/userprofile-service/socialProfile`, () =>
    HttpResponse.json({ displayName: "abc-display", userName: "testuser", fullName: "Test User", profileId: 1 }),
  ),

  // getWorkouts
  http.get(`${API}/workout-service/workouts`, async ({ request }) => {
    await record(request);
    return HttpResponse.json([{ workoutId: 1, workoutName: "A" }]);
  }),

  // getWorkoutById
  http.get(`${API}/workout-service/workout/123`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ workoutId: 123, workoutName: "Fetched" });
  }),

  // deleteWorkout
  http.delete(`${API}/workout-service/workout/123`, async ({ request }) => {
    await record(request);
    return new HttpResponse(null, { status: 204 });
  }),

  // downloadWorkout
  http.get(`${API}/workout-service/workout/FIT/123`, async ({ request }) => {
    await record(request);
    return new HttpResponse(new Uint8Array([1, 2, 3, 4]), {
      headers: { "Content-Type": "application/octet-stream" },
    });
  }),

  // uploadWorkout / uploadRunningWorkout / uploadCyclingWorkout / etc all hit this same URL
  http.post(`${API}/workout-service/workout`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ workoutId: 999, workoutName: "uploaded" });
  }),

  // updateWorkout
  http.put(`${API}/workout-service/workout/456`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ workoutId: 456, workoutName: "updated" });
  }),

  // pushWorkoutToDevice: resolution chain
  http.get(`${API}/device-service/deviceservice/mylastused`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ userDeviceId: 777 });
  }),
  http.post(`${API}/device-service/devicemessage/messages`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ status: "ok" });
  }),

  // getScheduledWorkouts (month 9 -> wire month 8)
  http.get(`${API}/calendar-service/year/2026/month/8`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ calendarItems: [] });
  }),

  // getScheduledWorkoutById
  http.get(`${API}/workout-service/schedule/555`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ scheduleId: 555, workoutId: 123 });
  }),

  // scheduleWorkout
  http.post(`${API}/workout-service/schedule/123`, async ({ request }) => {
    await record(request);
    return HttpResponse.json({ scheduleId: 1, workoutId: 123 });
  }),

  // unscheduleWorkout
  http.delete(`${API}/workout-service/schedule/555`, async ({ request }) => {
    await record(request);
    return new HttpResponse(null, { status: 204 });
  }),
);

const tokens: Tokens = {
  oauth1: { oauth_token: "o1", oauth_token_secret: "s1", domain: "garmin.com" },
  oauth2: {
    scope: "CONNECT_READ",
    jti: "j",
    token_type: "Bearer",
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    // Fixed far-future absolute epoch, NOT `Date.now() + 3600`: a couple of
    // tests below use `vi.setSystemTime` to jump the clock months ahead
    // (to test `getNextScheduledWorkout`'s December->January rollover),
    // which would make a `Date.now()`-relative expiry look expired.
    expires_at: Math.floor(Date.UTC(2035, 0, 1) / 1000),
    refresh_token_expires_in: 7200,
    refresh_token_expires_at: Math.floor(Date.UTC(2035, 0, 1) / 1000),
  },
};

function makeGarmin(): Garmin {
  const client = new GarminClient();
  client.setTokens(tokens);
  return new Garmin(client);
}

beforeEach(() => {
  seen.length = 0;
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
  server.close();
  vi.useRealTimers();
});

describe("workouts service", () => {
  it("getWorkouts composes the default-paginated URL", async () => {
    const g = makeGarmin();
    const result = await g.getWorkouts();
    expect(seen[0]!.url).toBe(`${API}/workout-service/workouts?start=0&limit=100`);
    expect(result).toEqual([{ workoutId: 1, workoutName: "A" }]);
  });

  it("getWorkouts stays nullable on a 204 (passes through unchecked, does NOT coalesce to [])", async () => {
    server.use(
      http.get(`${API}/workout-service/workouts`, () => new HttpResponse(null, { status: 204 })),
    );
    const g = makeGarmin();
    const result = await g.getWorkouts(0, 5);
    expect(result).toBeNull();
  });

  it("getWorkoutById composes the correct URL", async () => {
    const g = makeGarmin();
    const result = await g.getWorkoutById(123);
    expect(seen[0]!.url).toBe(`${API}/workout-service/workout/123`);
    expect(result).toEqual({ workoutId: 123, workoutName: "Fetched" });
  });

  it("deleteWorkout issues a DELETE to the workout path", async () => {
    const g = makeGarmin();
    await g.deleteWorkout(123);
    expect(seen[0]!.url).toBe(`${API}/workout-service/workout/123`);
    expect(seen[0]!.method).toBe("DELETE");
  });

  it("downloadWorkout hits the FIT path and returns a Buffer", async () => {
    const g = makeGarmin();
    const result = await g.downloadWorkout(123);
    expect(seen[0]!.url).toBe(`${API}/workout-service/workout/FIT/123`);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it("uploadWorkout POSTs an object body verbatim", async () => {
    const g = makeGarmin();
    const payload = { workoutName: "X", workoutSegments: [] };
    await g.uploadWorkout(payload);
    expect(seen[0]!.url).toBe(`${API}/workout-service/workout`);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.body).toEqual(payload);
  });

  it("uploadWorkout forwards a MULTI-SPORT workout verbatim, segments and all", async () => {
    // Shape captured from Garmin's own workout designer on 2026-09-23 and round-tripped live:
    // one workout, top-level sportType multi_sport, each segment carrying its own sportType.
    // Garmin preserved both segments and isSessionTransitionEnabled on read-back.
    //
    // NOTE stepOrder is GLOBAL across segments — 1 then 2, not 1 then 1. Numbering per-segment
    // gets a 400 "The workout steps need to have unique step orders". This test encodes the
    // working numbering so the example in the JSDoc cannot drift away from it.
    const g = makeGarmin();
    const payload = {
      workoutName: "Brick",
      sportType: { sportTypeId: WORKOUT_SPORT_TYPE_ID.MULTI_SPORT, sportTypeKey: "multi_sport", displayOrder: 5 },
      estimatedDurationInSecs: 3000,
      isSessionTransitionEnabled: true,
      workoutSegments: [
        {
          segmentOrder: 1,
          sportType: { sportTypeId: WORKOUT_SPORT_TYPE_ID.RUNNING, sportTypeKey: "running", displayOrder: 1 },
          workoutSteps: [{ stepOrder: 1, type: "ExecutableStepDTO" }],
        },
        {
          segmentOrder: 2,
          sportType: { sportTypeId: WORKOUT_SPORT_TYPE_ID.CYCLING, sportTypeKey: "cycling", displayOrder: 2 },
          workoutSteps: [{ stepOrder: 2, type: "ExecutableStepDTO" }],
        },
      ],
    };
    await g.uploadWorkout(payload);
    expect(seen[0]!.url).toBe(`${API}/workout-service/workout`);
    expect(seen[0]!.body).toEqual(payload);
    const body = seen[0]!.body as typeof payload;
    expect(body.workoutSegments.map((x) => x.sportType.sportTypeKey)).toEqual(["running", "cycling"]);
    expect(body.workoutSegments.flatMap((x) => x.workoutSteps.map((st) => st.stepOrder))).toEqual([1, 2]);
  });

  it("uploadWorkout forwards a REPEAT block with nested steps and a pace target verbatim", async () => {
    // Shape captured from Garmin's designer and round-tripped live on 2026-09-23.
    // Two things this pins, both of which are easy to get wrong and silent when wrong:
    //   1. stepOrder continues THROUGH the repeat's children (1, 2, then 3 and 4, then 5) — the
    //      nested steps share one global sequence rather than restarting inside the block.
    //   2. pace.zone target values are SPEEDS in m/s, and targetValueOne is the FASTER (larger)
    //      bound. 3.3333 m/s is ~5:00/km; 3.0 m/s is ~5:33/km.
    const g = makeGarmin();
    const payload = {
      workoutName: "Intervals",
      sportType: { sportTypeId: WORKOUT_SPORT_TYPE_ID.RUNNING, sportTypeKey: "running", displayOrder: 1 },
      estimatedDurationInSecs: 3600,
      workoutSegments: [{
        segmentOrder: 1,
        sportType: { sportTypeId: WORKOUT_SPORT_TYPE_ID.RUNNING, sportTypeKey: "running", displayOrder: 1 },
        workoutSteps: [
          { type: "ExecutableStepDTO", stepOrder: 1, stepType: { stepTypeId: 1, stepTypeKey: "warmup", displayOrder: 1 } },
          {
            type: "RepeatGroupDTO",
            stepOrder: 2,
            stepType: { stepTypeId: 6, stepTypeKey: "repeat", displayOrder: 6 },
            numberOfIterations: 3,
            smartRepeat: false,
            endCondition: { conditionTypeId: 7, conditionTypeKey: "iterations", displayOrder: 7 },
            workoutSteps: [
              {
                type: "ExecutableStepDTO", stepOrder: 3,
                stepType: { stepTypeId: 3, stepTypeKey: "interval", displayOrder: 3 },
                targetType: { workoutTargetTypeId: 6, workoutTargetTypeKey: "pace.zone", displayOrder: 6 },
                targetValueOne: 3.3333,
                targetValueTwo: 3.0,
              },
              { type: "ExecutableStepDTO", stepOrder: 4, stepType: { stepTypeId: 4, stepTypeKey: "recovery", displayOrder: 4 } },
            ],
          },
          { type: "ExecutableStepDTO", stepOrder: 5, stepType: { stepTypeId: 2, stepTypeKey: "cooldown", displayOrder: 2 } },
        ],
      }],
    };
    await g.uploadWorkout(payload);
    expect(seen[0]!.body).toEqual(payload);
    const seg = (seen[0]!.body as typeof payload).workoutSegments[0]!;
    const repeat = seg.workoutSteps[1] as { workoutSteps: { stepOrder: number }[] };
    expect(repeat.workoutSteps.map((x) => x.stepOrder)).toEqual([3, 4]);
  });

  it("uploadWorkout forwards a STRENGTH step's exercise pair and reps condition", async () => {
    // category + exerciseName are both SCREAMING_SNAKE_CASE, and reps ride in endConditionValue.
    const g = makeGarmin();
    const payload = {
      workoutName: "Squats",
      sportType: { sportTypeId: WORKOUT_SPORT_TYPE_ID.STRENGTH_TRAINING, sportTypeKey: "strength_training", displayOrder: 4 },
      estimatedDurationInSecs: 1800,
      workoutSegments: [{
        segmentOrder: 1,
        sportType: { sportTypeId: WORKOUT_SPORT_TYPE_ID.STRENGTH_TRAINING, sportTypeKey: "strength_training", displayOrder: 4 },
        workoutSteps: [{
          type: "ExecutableStepDTO", stepOrder: 1,
          stepType: { stepTypeId: 3, stepTypeKey: "interval", displayOrder: 3 },
          category: "SQUAT",
          exerciseName: "BARBELL_BACK_SQUAT",
          endCondition: { conditionTypeId: 10, conditionTypeKey: "reps", displayOrder: 10 },
          endConditionValue: 10,
        }],
      }],
    };
    await g.uploadWorkout(payload);
    expect(seen[0]!.body).toEqual(payload);
  });

  it("WORKOUT_SPORT_TYPE_ID matches Garmin's live enum, and flags the two broken ids", () => {
    // Read from GET /workout-service/workout/types -> workoutSportTypes on 2026-09-23.
    // Garmin's list is exactly: 1,2,3,4,5,6,7,8,9,10,11,13 — no walking, no hiking.
    expect({
      running: WORKOUT_SPORT_TYPE_ID.RUNNING,
      cycling: WORKOUT_SPORT_TYPE_ID.CYCLING,
      other: WORKOUT_SPORT_TYPE_ID.OTHER,
      swimming: WORKOUT_SPORT_TYPE_ID.SWIMMING,
      strength: WORKOUT_SPORT_TYPE_ID.STRENGTH_TRAINING,
      cardio: WORKOUT_SPORT_TYPE_ID.CARDIO_TRAINING,
      yoga: WORKOUT_SPORT_TYPE_ID.YOGA,
      pilates: WORKOUT_SPORT_TYPE_ID.PILATES,
      hiit: WORKOUT_SPORT_TYPE_ID.HIIT,
      multiSport: WORKOUT_SPORT_TYPE_ID.MULTI_SPORT,
      mobility: WORKOUT_SPORT_TYPE_ID.MOBILITY,
      rucking: WORKOUT_SPORT_TYPE_ID.RUCKING,
    }).toEqual({
      running: 1, cycling: 2, other: 3, swimming: 4, strength: 5, cardio: 6,
      yoga: 7, pilates: 8, hiit: 9, multiSport: 10, mobility: 11, rucking: 13,
    });

    // WALKING/HIKING are inherited from upstream and are NOT workout sport types. Garmin accepts
    // them and stores sportTypeId 0 / sportTypeKey null — a workout with no sport. They are kept
    // for parity; this asserts they remain OUTSIDE the valid set so nobody "tidies" them into it.
    const valid = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13]);
    expect(valid.has(WORKOUT_SPORT_TYPE_ID.WALKING)).toBe(false);
    expect(valid.has(WORKOUT_SPORT_TYPE_ID.HIKING)).toBe(false);
  });

  it("uploadWorkout forwards a TIME-BASED repeat, where numberOfIterations is null", async () => {
    // Garmin's HIIT designer "Repeat Until Time Is" produces endCondition: time with the seconds
    // in endConditionValue and numberOfIterations: null. Upstream types numberOfIterations as a
    // required number, which cannot express this; RepeatWorkoutGroup allows null. Round-tripped live.
    const g = makeGarmin();
    const payload = {
      workoutName: "AMRAP",
      sportType: { sportTypeId: WORKOUT_SPORT_TYPE_ID.HIIT, sportTypeKey: "hiit", displayOrder: 7 },
      estimatedDurationInSecs: 900,
      workoutSegments: [{
        segmentOrder: 1,
        sportType: { sportTypeId: WORKOUT_SPORT_TYPE_ID.HIIT, sportTypeKey: "hiit", displayOrder: 7 },
        workoutSteps: [{
          type: "RepeatGroupDTO",
          stepOrder: 1,
          stepType: { stepTypeId: 6, stepTypeKey: "repeat", displayOrder: 6 },
          numberOfIterations: null,
          endCondition: { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2 },
          endConditionValue: 600,
          workoutSteps: [{
            type: "ExecutableStepDTO",
            stepOrder: 2,
            category: "PUSH_UP",
            exerciseName: "WEIGHTED_PUSH_UP",
            endCondition: { conditionTypeId: 10, conditionTypeKey: "reps", displayOrder: 10 },
            endConditionValue: 10,
            weightValue: 9.0718474,
            weightUnit: { unitId: 8, unitKey: "kilogram", factor: 1000 },
          }],
        }],
      }],
    };
    await g.uploadWorkout(payload);
    expect(seen[0]!.body).toEqual(payload);
    const rep = (seen[0]!.body as typeof payload).workoutSegments[0]!.workoutSteps[0]!;
    expect(rep.numberOfIterations).toBeNull();
    expect(rep.endCondition.conditionTypeKey).toBe("time");
    expect(rep.endConditionValue).toBe(600);
  });

  it("uploadWorkout accepts an array body", async () => {
    const g = makeGarmin();
    const payload = [{ a: 1 }];
    await g.uploadWorkout(payload);
    expect(seen[0]!.body).toEqual(payload);
  });

  it("uploadWorkout JSON-parses a string body", async () => {
    const g = makeGarmin();
    await g.uploadWorkout(JSON.stringify({ workoutName: "from-string" }));
    expect(seen[0]!.body).toEqual({ workoutName: "from-string" });
  });

  it("uploadWorkout throws on invalid JSON string", async () => {
    const g = makeGarmin();
    await expect(g.uploadWorkout("{not json")).rejects.toThrow();
    expect(seen.length).toBe(0);
  });

  it("uploadWorkout throws on a non-object/array string result", async () => {
    const g = makeGarmin();
    await expect(g.uploadWorkout(JSON.stringify("just a string"))).rejects.toThrow();
  });

  it("updateWorkout PUTs, forcing workoutId to match the path id", async () => {
    const g = makeGarmin();
    await g.updateWorkout(456, { workoutId: 999, workoutName: "renamed" });
    expect(seen[0]!.url).toBe(`${API}/workout-service/workout/456`);
    expect(seen[0]!.method).toBe("PUT");
    expect(seen[0]!.body).toEqual({ workoutId: 456, workoutName: "renamed" });
  });

  it("updateWorkout rejects an array body (unlike uploadWorkout)", async () => {
    const g = makeGarmin();
    await expect(g.updateWorkout(456, JSON.stringify([1, 2]))).rejects.toThrow();
  });

  // --- per-sport upload helpers: exact composed body ---

  it("uploadRunningWorkout composes the default running sportType and delegates to POST /workout-service/workout", async () => {
    const g = makeGarmin();
    await g.uploadRunningWorkout(baseWorkoutInput);
    expect(seen[0]!.url).toBe(`${API}/workout-service/workout`);
    expect(seen[0]!.body).toEqual({
      ...baseWorkoutInput,
      sportType: { sportTypeId: 1, sportTypeKey: "running", displayOrder: 1 },
    });
  });

  it("uploadCyclingWorkout composes the default cycling sportType", async () => {
    const g = makeGarmin();
    await g.uploadCyclingWorkout(baseWorkoutInput);
    expect(seen[0]!.body).toEqual({
      ...baseWorkoutInput,
      sportType: { sportTypeId: 2, sportTypeKey: "cycling", displayOrder: 2 },
    });
  });

  it("uploadSwimmingWorkout composes the default swimming sportType", async () => {
    const g = makeGarmin();
    await g.uploadSwimmingWorkout(baseWorkoutInput);
    expect(seen[0]!.body).toEqual({
      ...baseWorkoutInput,
      sportType: { sportTypeId: 4, sportTypeKey: "swimming", displayOrder: 3 },
    });
  });

  it("uploadWalkingWorkout composes the default walking sportType (id 17, not in the core SportType enum)", async () => {
    const g = makeGarmin();
    await g.uploadWalkingWorkout(baseWorkoutInput);
    expect(seen[0]!.body).toEqual({
      ...baseWorkoutInput,
      sportType: { sportTypeId: 17, sportTypeKey: "walking", displayOrder: 17 },
    });
  });

  it("uploadHikingWorkout composes the default hiking sportType (id 18, not in the core SportType enum)", async () => {
    const g = makeGarmin();
    await g.uploadHikingWorkout(baseWorkoutInput);
    expect(seen[0]!.body).toEqual({
      ...baseWorkoutInput,
      sportType: { sportTypeId: 18, sportTypeKey: "hiking", displayOrder: 18 },
    });
  });

  it("uploadStrengthWorkout composes the default strength_training sportType", async () => {
    const g = makeGarmin();
    await g.uploadStrengthWorkout(baseWorkoutInput);
    expect(seen[0]!.body).toEqual({
      ...baseWorkoutInput,
      sportType: { sportTypeId: 5, sportTypeKey: "strength_training", displayOrder: 5 },
    });
  });

  it("the per-sport helpers pass through a caller-supplied sportType unchanged instead of the default", async () => {
    const g = makeGarmin();
    const override = { sportTypeId: 99, sportTypeKey: "custom", displayOrder: 1 };
    await g.uploadRunningWorkout({ ...baseWorkoutInput, sportType: override });
    expect((seen[0]!.body as { sportType: unknown }).sportType).toEqual(override);
  });

  it("the per-sport helpers reject a workout missing required fields", async () => {
    const g = makeGarmin();
    await expect(
      g.uploadRunningWorkout({ workoutName: "no segments" } as unknown as WorkoutInput),
    ).rejects.toThrow();
    expect(seen.length).toBe(0);
  });

  // --- push to device ---

  it("pushWorkoutToDevice uses explicit workoutId/deviceId without resolution calls", async () => {
    const g = makeGarmin();
    await g.pushWorkoutToDevice(123, 42);
    expect(seen).toHaveLength(2); // getWorkoutById (for messageName) + the final POST
    expect(seen[0]!.url).toBe(`${API}/workout-service/workout/123`);
    expect(seen[1]!.url).toBe(`${API}/device-service/devicemessage/messages`);
    expect(seen[1]!.method).toBe("POST");
    expect(seen[1]!.body).toEqual([
      {
        deviceId: 42,
        messageUrl: "workout-service/workout/FIT/123",
        messageType: "workouts",
        groupName: null,
        messageName: "Fetched",
        priority: 1,
        fileType: "FIT",
        metaDataId: 123,
      },
    ]);
  });

  it("pushWorkoutToDevice resolves a missing deviceId via getDeviceLastUsed's userDeviceId", async () => {
    const g = makeGarmin();
    await g.pushWorkoutToDevice(123);
    const deviceLookup = seen.find((s) => s.url === `${API}/device-service/deviceservice/mylastused`);
    expect(deviceLookup).toBeDefined();
    const finalPost = seen.find((s) => s.url === `${API}/device-service/devicemessage/messages`);
    expect((finalPost!.body as [{ deviceId: number }])[0].deviceId).toBe(777);
  });

  it("pushWorkoutToDevice resolves a missing workoutId via getWorkouts(0, 1)'s first result", async () => {
    server.use(
      http.get(`${API}/workout-service/workouts`, async ({ request }) => {
        await record(request);
        return HttpResponse.json([{ workoutId: 321, workoutName: "First" }]);
      }),
      http.get(`${API}/workout-service/workout/321`, async ({ request }) => {
        await record(request);
        return HttpResponse.json({ workoutId: 321, workoutName: "First" });
      }),
    );
    const g = makeGarmin();
    await g.pushWorkoutToDevice(undefined, 42);
    const listCall = seen.find((s) => s.url.startsWith(`${API}/workout-service/workouts?`));
    expect(listCall?.url).toBe(`${API}/workout-service/workouts?start=0&limit=1`);
    const finalPost = seen.find((s) => s.url === `${API}/device-service/devicemessage/messages`);
    expect((finalPost!.body as [{ metaDataId: number; messageUrl: string }])[0]).toMatchObject({
      metaDataId: 321,
      messageUrl: "workout-service/workout/FIT/321",
    });
  });

  it("pushWorkoutToDevice throws when no workouts exist to resolve", async () => {
    server.use(
      http.get(`${API}/workout-service/workouts`, () => HttpResponse.json([])),
    );
    const g = makeGarmin();
    await expect(g.pushWorkoutToDevice(undefined, 42)).rejects.toThrow(/No workouts found to push/);
  });

  // --- scheduling ---

  it("getScheduledWorkouts converts a 1-12 month to the wire's 0-indexed month", async () => {
    const g = makeGarmin();
    const result = await g.getScheduledWorkouts(2026, 9);
    expect(seen[0]!.url).toBe(`${API}/calendar-service/year/2026/month/8`);
    expect(result).toEqual({ calendarItems: [] });
  });

  it("getScheduledWorkouts rejects an out-of-range month", async () => {
    const g = makeGarmin();
    await expect(g.getScheduledWorkouts(2026, 13)).rejects.toThrow();
    await expect(g.getScheduledWorkouts(2026, 0)).rejects.toThrow();
  });

  it("getScheduledWorkouts rejects a year below 2000", async () => {
    const g = makeGarmin();
    await expect(g.getScheduledWorkouts(1999, 6)).rejects.toThrow();
  });

  it("getScheduledWorkoutById uses the DIFFERENT /workout-service/schedule base, not /calendar-service", async () => {
    const g = makeGarmin();
    const result = await g.getScheduledWorkoutById(555);
    expect(seen[0]!.url).toBe(`${API}/workout-service/schedule/555`);
    expect(result).toEqual({ scheduleId: 555, workoutId: 123 });
  });

  it("getNextScheduledWorkout merges current+next month, filters to future workout items, and returns the earliest", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T12:00:00Z"));
    server.use(
      http.get(`${API}/calendar-service/year/2026/month/8`, () =>
        HttpResponse.json({
          calendarItems: [
            { itemType: "workout", date: "2026-09-20" }, // past, filtered out
            { itemType: "race", date: "2026-09-25" }, // wrong itemType, filtered out
            { itemType: "workout", date: "2026-09-28", workoutId: 1 },
          ],
        }),
      ),
      http.get(`${API}/calendar-service/year/2026/month/9`, () =>
        HttpResponse.json({
          calendarItems: [{ itemType: "workout", date: "2026-09-26", workoutId: 2 }],
        }),
      ),
    );
    const g = makeGarmin();
    const result = await g.getNextScheduledWorkout();
    expect(result).toEqual({ itemType: "workout", date: "2026-09-26", workoutId: 2 });
  });

  it("getNextScheduledWorkout handles the December->January rollover and returns {} when nothing matches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-15T12:00:00Z"));
    server.use(
      http.get(`${API}/calendar-service/year/2026/month/11`, () =>
        HttpResponse.json({ calendarItems: [] }),
      ),
      http.get(`${API}/calendar-service/year/2027/month/0`, ({ request }) => {
        seen.push({ url: request.url, method: request.method });
        return HttpResponse.json({ calendarItems: [] });
      }),
    );
    const g = makeGarmin();
    const result = await g.getNextScheduledWorkout();
    expect(seen.some((s) => s.url === `${API}/calendar-service/year/2027/month/0`)).toBe(true);
    expect(result).toEqual({});
  });

  it("scheduleWorkout POSTs {date} to /workout-service/schedule/{workoutId}", async () => {
    const g = makeGarmin();
    const result = await g.scheduleWorkout(123, "2026-09-25");
    expect(seen[0]!.url).toBe(`${API}/workout-service/schedule/123`);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.body).toEqual({ date: "2026-09-25" });
    expect(result).toEqual({ scheduleId: 1, workoutId: 123 });
  });

  it("unscheduleWorkout DELETEs /workout-service/schedule/{scheduledWorkoutId}", async () => {
    const g = makeGarmin();
    await g.unscheduleWorkout(555);
    expect(seen[0]!.url).toBe(`${API}/workout-service/schedule/555`);
    expect(seen[0]!.method).toBe("DELETE");
  });
});
