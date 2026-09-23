import { describe, expect, it } from "vitest";
import { pathSegment, validateSportKey, validateUuid } from "../../src/util/validate.js";
import { GarminError } from "../../src/errors.js";

describe("validateSportKey", () => {
  it("upper-cases an already-uppercase key", () => {
    expect(validateSportKey("RUNNING")).toBe("RUNNING");
  });

  it("upper-cases a lower-case key", () => {
    expect(validateSportKey("running")).toBe("RUNNING");
  });

  it("upper-cases a mixed-case key", () => {
    expect(validateSportKey("Trail_Running")).toBe("TRAIL_RUNNING");
  });

  it("accepts underscores", () => {
    expect(validateSportKey("mountain_biking")).toBe("MOUNTAIN_BIKING");
  });

  it("rejects a key containing digits", () => {
    expect(() => validateSportKey("running5")).toThrow(GarminError);
  });

  it("rejects a key containing spaces", () => {
    expect(() => validateSportKey("trail running")).toThrow(GarminError);
  });

  it("rejects an empty string", () => {
    expect(() => validateSportKey("")).toThrow(GarminError);
  });
});

describe("pathSegment", () => {
  it("leaves legitimate ids, UUIDs, dates and display names unchanged", () => {
    for (const value of [
      "19216801",
      "a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6",
      "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      "2026-01-01",
      "RUNNING",
      "abc-display",
    ]) {
      expect(pathSegment(value)).toBe(value);
    }
    expect(pathSegment(19216801)).toBe("19216801");
  });

  it("encodes the separators that make a raw id a request-redirection primitive", () => {
    expect(pathSegment("../../weight-service/weight")).toBe("..%2F..%2Fweight-service%2Fweight");
    expect(pathSegment("1?x=y#frag")).toBe("1%3Fx%3Dy%23frag");
  });
});

describe("validateUuid", () => {
  it("accepts hex with and without hyphens", () => {
    expect(validateUuid("a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6")).toBe(
      "a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6",
    );
    expect(validateUuid("DEADBEEF")).toBe("DEADBEEF");
  });

  it("rejects an empty or non-hex value before any request is made", () => {
    expect(() => validateUuid("")).toThrow(GarminError);
    expect(() => validateUuid("---")).toThrow(GarminError);
    expect(() => validateUuid("../../gear-service")).toThrow(/Invalid gear UUID/);
  });
});
