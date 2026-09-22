import { describe, expect, it } from "vitest";
import { validateSportKey } from "../../src/util/validate.js";
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
