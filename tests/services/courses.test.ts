import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { GarminError } from "../../src/errors.js";
import type { Tokens } from "../../src/auth/tokens.js";
import type { CourseGeoPoint } from "../../src/types/courses.js";

// Response shapes below are trimmed from the live responses recorded on 2026-09-24 (smoke:gaps).
const API = "https://connectapi.garmin.com";
const seen: { url: string; method: string; body?: unknown; file?: { name: string; field: string } }[] = [];

const point = (lat: number): CourseGeoPoint => ({
  latitude: lat,
  longitude: -0.17,
  elevation: null,
  distance: 0,
  timestamp: null,
});
const PARSED = {
  courseId: null,
  courseName: "gpx track name",
  rulePK: null,
  activityTypePk: null,
  distanceMeter: null,
  geoPoints: [point(51.505), point(51.506), point(51.507)],
  coursePoints: [],
};
const STORED = {
  courseId: 518053434,
  courseName: "stored name",
  rulePK: 2,
  activityTypePk: 1,
  distanceMeter: 1042.07,
  description: null,
  geoPoints: [point(51.505), point(51.506)],
  coursePoints: [],
  courseLines: [{ sortOrder: 1, points: null }],
};

const server = setupServer(
  http.get(`${API}/web-gateway/course/owner/`, ({ request }) => {
    seen.push({ url: request.url, method: request.method });
    return HttpResponse.json({ coursesForUser: [{ courseId: 518053434, courseName: "stored name" }] });
  }),
  http.post(`${API}/course-service/course/import`, async ({ request }) => {
    const form = await request.formData();
    const file = form.get("file");
    seen.push({
      url: request.url,
      method: request.method,
      file: file instanceof File ? { name: file.name, field: "file" } : undefined,
    });
    return HttpResponse.json(PARSED);
  }),
  http.post(`${API}/course-service/course`, async ({ request }) => {
    const body = await request.clone().json();
    seen.push({ url: request.url, method: request.method, body });
    return HttpResponse.json({ ...STORED, courseName: (body as { courseName: string }).courseName });
  }),
  http.get(`${API}/course-service/course/gpx/:id`, ({ request }) => {
    seen.push({ url: request.url, method: request.method });
    return new HttpResponse('<?xml version="1.0"?><gpx></gpx>', {
      headers: { "content-type": "application/gpx+xml" },
    });
  }),
  http.get(`${API}/course-service/course/:id`, ({ request }) => {
    seen.push({ url: request.url, method: request.method });
    return HttpResponse.json(STORED);
  }),
  http.put(`${API}/course-service/course/:id`, async ({ request }) => {
    const body = await request.clone().json();
    seen.push({ url: request.url, method: request.method, body });
    return HttpResponse.json(body);
  }),
  http.delete(`${API}/course-service/course/:id`, ({ request }) => {
    seen.push({ url: request.url, method: request.method });
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
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token_expires_in: 7200,
    refresh_token_expires_at: Math.floor(Date.now() / 1000) + 7200,
  },
};

function makeGarmin(): Garmin {
  const client = new GarminClient();
  client.setTokens(tokens);
  return new Garmin(client);
}

const gpx = () => new Blob(['<?xml version="1.0"?><gpx></gpx>']);

beforeEach(() => {
  seen.length = 0;
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("listCourses", () => {
  it("GETs the owner list (trailing slash) and returns the envelope, not a bare array", async () => {
    const result = await makeGarmin().listCourses();
    expect(seen[0]!.url).toBe(`${API}/web-gateway/course/owner/`);
    expect(result?.coursesForUser).toEqual([{ courseId: 518053434, courseName: "stored name" }]);
  });
});

describe("getCourse", () => {
  it("GETs the course by id", async () => {
    await expect(makeGarmin().getCourse(518053434)).resolves.toMatchObject({ courseId: 518053434 });
    expect(seen[0]!.url).toBe(`${API}/course-service/course/518053434`);
  });

  it("encodes the id, so a traversal string cannot redirect the request", async () => {
    await makeGarmin().getCourse("../../weight-service/x");
    expect(seen[0]!.url).toBe(`${API}/course-service/course/..%2F..%2Fweight-service%2Fx`);
  });
});

describe("importCourseGpx", () => {
  it("uploads the GPX as multipart field `file` and returns the unsaved, parsed course", async () => {
    const parsed = await makeGarmin().importCourseGpx(gpx(), "route.gpx");
    expect(seen[0]!.url).toBe(`${API}/course-service/course/import`);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.file).toEqual({ name: "route.gpx", field: "file" });
    expect(parsed.courseId).toBeNull();
    expect(parsed.geoPoints).toHaveLength(3);
  });

  it("rejects anything but .gpx before sending a request", async () => {
    await expect(makeGarmin().importCourseGpx(gpx(), "route.fit")).rejects.toThrow(GarminError);
    expect(seen).toHaveLength(0);
  });

  it("throws when Garmin returns an empty body", async () => {
    server.use(http.post(`${API}/course-service/course/import`, () => new HttpResponse(null, { status: 204 })));
    await expect(makeGarmin().importCourseGpx(gpx(), "route.gpx")).rejects.toThrow(/no parsed course/);
  });
});

describe("createCourse", () => {
  it("POSTs the web client's template: running and private by default, start point = first point", async () => {
    const geoPoints = [point(51.505), point(51.506)];
    await makeGarmin().createCourse({ name: "Park loop", geoPoints });
    const body = seen[0]!.body as Record<string, unknown>;
    expect(seen[0]!.url).toBe(`${API}/course-service/course`);
    expect(seen[0]!.method).toBe("POST");
    expect(body).toMatchObject({
      courseName: "Park loop",
      activityTypePk: 1,
      rulePK: 2,
      geoPoints,
      coursePoints: [],
      startPoint: geoPoints[0],
      coordinateSystem: "WGS84",
      sourceTypeId: 3,
    });
  });

  it("maps privacy public -> rulePK 1 and passes activityTypeId through", async () => {
    await makeGarmin().createCourse({
      name: "Ride",
      geoPoints: [point(1), point(2)],
      privacy: "public",
      activityTypeId: 10,
    });
    expect(seen[0]!.body).toMatchObject({ rulePK: 1, activityTypePk: 10 });
  });

  it.each([
    [{ name: "  ", geoPoints: [point(1), point(2)] }, /non-empty name/],
    [{ name: "x", geoPoints: [point(1)] }, /at least two geoPoints/],
  ])("validates before sending: %o", async (input, message) => {
    await expect(makeGarmin().createCourse(input)).rejects.toThrow(message);
    expect(seen).toHaveLength(0);
  });

  it("rejects an unknown privacy value", async () => {
    await expect(
      makeGarmin().createCourse({
        name: "x",
        geoPoints: [point(1), point(2)],
        privacy: "friends" as never,
      }),
    ).rejects.toThrow(/Unknown course privacy/);
    expect(seen).toHaveLength(0);
  });
});

describe("createCourseFromGpx", () => {
  it("imports, then creates from the parsed track, named after the GPX track by default", async () => {
    const created = await makeGarmin().createCourseFromGpx(gpx(), "route.gpx");
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      `POST ${API}/course-service/course/import`,
      `POST ${API}/course-service/course`,
    ]);
    expect(seen[1]!.body).toMatchObject({ courseName: "gpx track name", geoPoints: PARSED.geoPoints });
    expect(created?.courseId).toBe(518053434);
  });

  it("prefers an explicit name, and falls back to the filename when the GPX has none", async () => {
    await makeGarmin().createCourseFromGpx(gpx(), "route.gpx", { name: "Mine", privacy: "public" });
    expect(seen[1]!.body).toMatchObject({ courseName: "Mine", rulePK: 1 });

    seen.length = 0;
    server.use(
      http.post(`${API}/course-service/course/import`, () => HttpResponse.json({ ...PARSED, courseName: null })),
    );
    await makeGarmin().createCourseFromGpx(gpx(), "Evening Run.GPX");
    expect(seen[0]!.body).toMatchObject({ courseName: "Evening Run" });
  });
});

describe("updateCourse", () => {
  it("reads the record, then PUTs the WHOLE record back with only the changes applied", async () => {
    await makeGarmin().updateCourse(518053434, { name: "Renamed", privacy: "public" });
    expect(seen.map((s) => s.method)).toEqual(["GET", "PUT"]);
    expect(seen[1]!.url).toBe(`${API}/course-service/course/518053434`);
    expect(seen[1]!.body).toEqual({ ...STORED, courseName: "Renamed", rulePK: 1 });
  });

  it("changes privacy alone without touching the name", async () => {
    await makeGarmin().updateCourse(518053434, { privacy: "private" });
    expect(seen[1]!.body).toMatchObject({ courseName: "stored name", rulePK: 2 });
  });

  it.each([
    [{}, /at least one of name or privacy/],
    [{ name: " " }, /empty name/],
  ])("validates before any request: %o", async (changes, message) => {
    await expect(makeGarmin().updateCourse(1, changes)).rejects.toThrow(message);
    expect(seen).toHaveLength(0);
  });
});

describe("deleteCourse", () => {
  it("DELETEs the course and resolves null on 204", async () => {
    await expect(makeGarmin().deleteCourse(518053434)).resolves.toBeNull();
    expect(seen[0]!.method).toBe("DELETE");
    expect(seen[0]!.url).toBe(`${API}/course-service/course/518053434`);
  });
});

describe("downloadCourseGpx", () => {
  it("GETs the GPX export as bytes", async () => {
    const bytes = await makeGarmin().downloadCourseGpx(518053434);
    expect(seen[0]!.url).toBe(`${API}/course-service/course/gpx/518053434`);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.toString("utf8")).toContain("<gpx");
  });
});
