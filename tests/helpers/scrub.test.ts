import { describe, expect, it } from "vitest";
import { scrub } from "./scrub.js";

describe("scrub", () => {
  it("replaces name fields", () => {
    expect(scrub({ fullName: "Real Person", userName: "realuser" })).toEqual({
      fullName: "Test User",
      userName: "testuser",
    });
  });

  it("replaces the display name consistently", () => {
    expect(scrub({ displayName: "9f8e-real-guid" })).toEqual({
      displayName: "abc-display",
    });
  });

  it("redacts emails anywhere in a string", () => {
    expect(scrub({ note: "contact me at real@person.test please" })).toEqual({
      note: "contact me at redacted@example.test please",
    });
  });

  it("zeroes coordinates", () => {
    expect(scrub({ startLatitude: 46.05, startLongitude: 14.5 })).toEqual({
      startLatitude: 0,
      startLongitude: 0,
    });
  });

  it("redacts token-ish fields", () => {
    expect(
      scrub({ access_token: "real", refresh_token: "real", oauth_token_secret: "real" }),
    ).toEqual({
      access_token: "redacted",
      refresh_token: "redacted",
      oauth_token_secret: "redacted",
    });
  });

  it("recurses into arrays and nested objects", () => {
    expect(scrub({ items: [{ fullName: "Real Person" }] })).toEqual({
      items: [{ fullName: "Test User" }],
    });
  });

  it("leaves ordinary metric values alone", () => {
    expect(scrub({ totalSteps: 8123, restingHeartRate: 52 })).toEqual({
      totalSteps: 8123,
      restingHeartRate: 52,
    });
  });

  it("replaces numeric ids", () => {
    expect(scrub({ profileId: 987654321, userProfileId: 987654321 })).toEqual({
      profileId: 1,
      userProfileId: 1,
    });
  });

  it("zeroes coordinate fields with unanticipated key variants", () => {
    expect(scrub({ startLatitudeDegrees: 46.0511 })).toEqual({
      startLatitudeDegrees: 0,
    });
  });

  it("zeroes short lat/lon keys nested inside arrays", () => {
    expect(scrub({ laps: [{ lat: 46.05, lon: 14.5 }] })).toEqual({
      laps: [{ lat: 0, lon: 0 }],
    });
  });

  it("replaces ids that arrive as strings", () => {
    expect(scrub({ profileId: "987654321" })).toEqual({ profileId: "1" });
  });

  it("replaces owner names that aren't in the fixed-key table", () => {
    expect(scrub({ ownerFullName: "Real Person" })).toEqual({
      ownerFullName: "Test User",
    });
  });

  it("replaces free-text names embedded in activity titles", () => {
    expect(scrub({ activityName: "Ran with Real Person" })).toEqual({
      activityName: "Test User",
    });
  });

  it("scrubs a bare top-level array of activity objects", () => {
    expect(scrub([{ activityName: "Real run", profileId: 42 }])).toEqual([
      { activityName: "Test User", profileId: 1 },
    ]);
  });

  it("does not mutate its input", () => {
    const input = { fullName: "Real Person", items: [{ lat: 46.05 }] };
    const snapshot = JSON.parse(JSON.stringify(input));
    scrub(input);
    expect(input).toEqual(snapshot);
  });
});
