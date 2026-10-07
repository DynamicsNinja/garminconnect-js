import { describe, expect, it } from "vitest";
import { GarminAuthError, GarminHttpError, GarminRateLimitError } from "garminconnect-js";
import { describeError, LOGIN_HINT } from "../src/errors.js";
import { NotLoggedInError } from "../src/session.js";

describe("describeError", () => {
  it("tells Claude how long to wait when Garmin says so", () => {
    expect(describeError(new GarminRateLimitError("Too many requests", 30))).toBe(
      "Garmin is rate limiting requests; retry after 30 s. Too many requests",
    );
  });

  it("leaves out the wait when Garmin gives none", () => {
    expect(describeError(new GarminRateLimitError("Too many requests"))).toBe(
      "Garmin is rate limiting requests. Too many requests",
    );
  });

  it("points at the login command for a missing or rejected session", () => {
    expect(describeError(new NotLoggedInError("none"))).toBe(`Not logged in to Garmin: ${LOGIN_HINT}.`);
    expect(describeError(new GarminAuthError("expired"))).toContain(LOGIN_HINT);
  });

  it("reports the HTTP status for other Garmin failures", () => {
    expect(describeError(new GarminHttpError("boom", 502, "https://x", ""))).toBe("Garmin returned HTTP 502: boom");
  });
});

it("uses a caller-supplied hint for auth errors", () => {
  expect(describeError(new GarminAuthError("x"), "reconnect it")).toBe("Garmin session expired or was rejected (x): reconnect it.");
});
