import { describe, expect, it } from "vitest";
import {
  GarminAuthError,
  GarminConnectionError,
  GarminError,
  GarminHttpError,
  GarminRateLimitError,
} from "../src/errors.js";

describe("error hierarchy", () => {
  it("all errors extend GarminError and carry their name", () => {
    const errors = [
      new GarminError("base"),
      new GarminAuthError("auth"),
      new GarminConnectionError("conn"),
      new GarminRateLimitError("rate", 30),
      new GarminHttpError("http", 500, "https://x.test", "body"),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(GarminError);
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe(e.constructor.name);
      expect(e.stack).toBeDefined();
    }
  });

  it("GarminRateLimitError carries retryAfter seconds", () => {
    expect(new GarminRateLimitError("rate", 30).retryAfter).toBe(30);
    expect(new GarminRateLimitError("rate").retryAfter).toBeUndefined();
  });

  it("GarminHttpError carries status, url and body", () => {
    const e = new GarminHttpError("boom", 503, "https://x.test/a", "down");
    expect(e.status).toBe(503);
    expect(e.url).toBe("https://x.test/a");
    expect(e.body).toBe("down");
  });

  it("errors are catchable by subclass", () => {
    try {
      throw new GarminAuthError("nope");
    } catch (e) {
      expect(e).toBeInstanceOf(GarminAuthError);
      expect(e).not.toBeInstanceOf(GarminHttpError);
    }
  });
});
