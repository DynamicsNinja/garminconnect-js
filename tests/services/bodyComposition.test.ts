import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { GarminError } from "../../src/errors.js";
import type { Tokens } from "../../src/auth/tokens.js";

const API = "https://connectapi.garmin.com";
const seen: { url: string; method: string; body?: unknown }[] = [];

function record(request: Request, body?: unknown) {
  seen.push({ url: request.url, method: request.method, body });
}

let lastUploadBytes: Uint8Array | null = null;

const server = setupServer(
  http.get(`${API}/userprofile-service/socialProfile`, () =>
    HttpResponse.json({
      displayName: "abc-display",
      userName: "testuser",
      fullName: "Test User",
      profileId: 1,
    }),
  ),
  http.get(`${API}/weight-service/weight/dateRange`, ({ request }) => {
    record(request);
    return HttpResponse.json({ totalAverage: { weight: 70000 } });
  }),
  http.post(`${API}/upload-service/upload`, async ({ request }) => {
    record(request);
    const form = await request.clone().formData();
    const file = form.get("file");
    if (file instanceof Blob) {
      lastUploadBytes = new Uint8Array(await file.arrayBuffer());
    }
    return HttpResponse.json({ detailedImportResult: { fileName: "body_composition.fit" } });
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

beforeEach(() => {
  seen.length = 0;
  lastUploadBytes = null;
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("bodyComposition service", () => {
  describe("getBodyComposition", () => {
    it("composes the dateRange URL with startDate/endDate (enddate defaults to startdate)", async () => {
      await makeGarmin().getBodyComposition("2026-09-22");
      const url = new URL(seen[0]!.url);
      expect(url.origin + url.pathname).toBe(`${API}/weight-service/weight/dateRange`);
      expect(url.searchParams.get("startDate")).toBe("2026-09-22");
      expect(url.searchParams.get("endDate")).toBe("2026-09-22");
    });

    it("uses a distinct enddate when given", async () => {
      await makeGarmin().getBodyComposition("2026-09-15", "2026-09-22");
      const url = new URL(seen[0]!.url);
      expect(url.searchParams.get("startDate")).toBe("2026-09-15");
      expect(url.searchParams.get("endDate")).toBe("2026-09-22");
    });

    it("throws GarminError when startdate is after enddate", async () => {
      await expect(makeGarmin().getBodyComposition("2026-09-22", "2026-09-01")).rejects.toThrow(
        GarminError,
      );
    });

    it("returns null on a 204 (passes through unchecked)", async () => {
      server.use(
        http.get(`${API}/weight-service/weight/dateRange`, () => new HttpResponse(null, { status: 204 })),
      );
      const result = await makeGarmin().getBodyComposition("2026-09-22");
      expect(result).toBeNull();
    });
  });

  describe("addBodyComposition", () => {
    it("POSTs a multipart .fit upload to /upload-service/upload", async () => {
      await makeGarmin().addBodyComposition(93);
      expect(seen[0]!.method).toBe("POST");
      expect(seen[0]!.url).toBe(`${API}/upload-service/upload`);
      expect(lastUploadBytes).not.toBeNull();
    });

    it("builds a well-formed FIT header (.FIT magic, header_size 12) and encodes weight*100", async () => {
      await makeGarmin().addBodyComposition(93);
      const bytes = lastUploadBytes!;
      expect(bytes.length).toBeGreaterThan(12);
      expect(bytes[0]).toBe(12); // header_size
      const magic = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
      expect(magic).toBe(".FIT");
      // The weight_scale message's `weight` field is packed as
      // uint16 little-endian = round(weight_kg * 100) — 93 -> 9300 -> 0x2454.
      const bodyBytes = Array.from(bytes);
      const has9300LE = bodyBytes.some(
        (_, i) => i + 1 < bodyBytes.length && bodyBytes[i]! + bodyBytes[i + 1]! * 256 === 9300,
      );
      expect(has9300LE).toBe(true);
    });

    it("rejects a non-positive weight before building any FIT bytes", async () => {
      await expect(makeGarmin().addBodyComposition(0)).rejects.toThrow(GarminError);
      await expect(makeGarmin().addBodyComposition(-5)).rejects.toThrow(GarminError);
    });

    it("rejects an invalid timestamp string", async () => {
      await expect(
        makeGarmin().addBodyComposition(93, { timestamp: "not-a-date" }),
      ).rejects.toThrow(GarminError);
    });
  });
});
