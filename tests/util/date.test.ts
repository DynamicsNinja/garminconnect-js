import { describe, expect, it } from "vitest";
import { formatDate, formatGmtTimestamp, formatLocalTimestamp } from "../../src/util/date.js";

describe("formatDate", () => {
  it("passes a well-formed string through", () => {
    expect(formatDate("2026-09-22")).toBe("2026-09-22");
  });

  it("formats a Date as YYYY-MM-DD in UTC", () => {
    expect(formatDate(new Date("2026-09-22T23:30:00Z"))).toBe("2026-09-22");
  });

  it("zero-pads month and day", () => {
    expect(formatDate(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01-05");
  });

  it("rejects a malformed string", () => {
    expect(() => formatDate("22-09-2026")).toThrow(/YYYY-MM-DD/);
    expect(() => formatDate("2026-9-2")).toThrow(/YYYY-MM-DD/);
  });

  it("rejects an impossible date", () => {
    expect(() => formatDate("2026-13-01")).toThrow(/valid date/);
  });

  it("rejects an invalid Date object", () => {
    expect(() => formatDate(new Date("nope"))).toThrow(/valid date/);
  });

  it("rejects a calendar date that JavaScript would silently roll over", () => {
    // Without the round-trip comparison in formatDate, these would silently
    // roll forward (e.g. Feb 30 -> Mar 2) instead of throwing.
    expect(() => formatDate("2026-02-30")).toThrow(/valid date/);
    expect(() => formatDate("2026-04-31")).toThrow(/valid date/); // April has 30 days
    expect(() => formatDate("2026-02-29")).toThrow(/valid date/); // 2026 is not a leap year
  });

  it("accepts Feb 29 in a leap year", () => {
    expect(formatDate("2028-02-29")).toBe("2028-02-29"); // 2028 is a leap year
  });
});

describe("formatLocalTimestamp / formatGmtTimestamp", () => {
  it("formats a local wall-clock timestamp with zero-padded fields", () => {
    const when = new Date(2026, 0, 5, 9, 3, 7); // local Jan 5 2026, 09:03:07 (month is 0-indexed)
    expect(formatLocalTimestamp(when)).toBe("2026-01-05T09:03:07.00");
  });

  it("formats a GMT/UTC timestamp from the same instant", () => {
    const when = new Date("2026-09-22T23:30:07.000Z");
    expect(formatGmtTimestamp(when)).toBe("2026-09-22T23:30:07.00");
  });

  it("local and GMT formatting diverge for the same instant on a non-UTC machine", () => {
    // A single fixed instant, read both ways, so this is deterministic
    // regardless of which timezone the test runs under: it only asserts a
    // difference when the process timezone actually has a nonzero offset,
    // detected at runtime rather than assumed.
    const when = new Date("2026-09-22T23:30:07.000Z");
    const local = formatLocalTimestamp(when);
    const gmt = formatGmtTimestamp(when);
    expect(gmt).toBe("2026-09-22T23:30:07.00");
    if (when.getTimezoneOffset() !== 0) {
      expect(local).not.toBe(gmt);
    } else {
      expect(local).toBe(gmt);
    }
  });

  it("formatLocalTimestamp uses the local calendar date, not the UTC one", () => {
    // Constructed from local getters, so this is inherently about the
    // machine's local timezone; assert self-consistency against the same
    // getters rather than a hard-coded string.
    const when = new Date(2026, 8, 22, 0, 30, 0); // local Sep 22 2026, 00:30:00
    const pad = (n: number) => String(n).padStart(2, "0");
    const expected =
      `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
      `T${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}.00`;
    expect(formatLocalTimestamp(when)).toBe(expected);
  });
});
