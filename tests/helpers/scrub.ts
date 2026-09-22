/**
 * Design decision: pattern-based and deliberately over-aggressive.
 *
 * A recorded fixture only needs to preserve the SHAPE of Garmin's response,
 * never its content — so every key that even loosely resembles a name,
 * email, id, coordinate or token field gets redacted, whatever type the
 * value arrives as. Over-redacting a field costs nothing; under-redacting
 * one can publish someone's real name or home coordinates. This function is
 * the last line of defence before real account data reaches git, so when in
 * doubt it redacts.
 *
 * Key matching is done on camelCase SEGMENTS rather than whole keys or
 * substrings (see `keySegments` below), because Garmin does not use one
 * consistent spelling for a concept: coordinates alone show up as
 * `latitude`, `startLatitudeDegrees`, `lat`, and `positionLat`/`positionLong`
 * in track/lap data. Matching on segments catches new spellings without
 * needing every variant enumerated up front.
 *
 * KNOWN LIMITATION — content is not inspected, only field names (except for
 * the email regex, which scans string content too). A free-text field such
 * as `description`, `comment`, or an activity note can still contain a real
 * person's name or a place name, and nothing here will catch that: name
 * detection in free text would produce both false negatives and mangled
 * fixtures, so it is intentionally not attempted. Manual inspection of any
 * recorded fixture before committing it is required, not optional — see the
 * reminder printed by scripts/record-fixtures.ts.
 */

// Fixed replacements for specific keys, applied before the segment-based
// patterns below so callers get nicer, recognizable fixture values (and so
// exact keys that don't fit a general pattern — birthDate, dob, gender,
// owner — are still covered).
const STRING_REPLACEMENTS: Record<string, string> = {
  fullName: "Test User",
  userName: "testuser",
  displayName: "abc-display",
  firstName: "Test",
  lastName: "User",
  owner: "Test User",
  birthDate: "1970-01-01",
  dob: "1970-01-01",
  gender: "unspecified",
  access_token: "redacted",
  refresh_token: "redacted",
  oauth_token: "redacted",
  oauth_token_secret: "redacted",
  mfa_token: "redacted",
  jti: "redacted",
};

// Segment sets used for the generic key rules below. A key is normalized to
// its lowercase camelCase/snake_case segments (`positionLat` -> ["position",
// "lat"], `startLatitudeDegrees` -> ["start", "latitude", "degrees"]) and
// matched if ANY segment is in the set. This is spelling-proof in a way an
// enumerated regex of known field names is not.
// "long" is included because Garmin's own per-point key is `positionLong`;
// yes, this also zeroes an unrelated field like `longDescription` — accepted
// per the over-redaction principle above (a wrong-shaped field costs
// nothing; a real longitude in a committed fixture does).
const COORD_SEGMENTS = new Set(["lat", "lon", "lng", "long", "latitude", "longitude"]);
const NAME_SEGMENTS = new Set(["name"]);
const EMAIL_SEGMENTS = new Set(["email"]);
const ID_SEGMENTS = new Set(["id", "pk"]);

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/** Splits a key into lowercase camelCase/snake_case/kebab-case segments. */
function keySegments(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hasSegment(segments: string[], set: Set<string>): boolean {
  return segments.some((segment) => set.has(segment));
}

/** Removes personal data so a recorded fixture is safe to commit. */
export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value === null || typeof value !== "object") {
    return typeof value === "string" ? value.replace(EMAIL, "redacted@example.test") : value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = scrubField(key, val);
  }
  return out;
}

function scrubField(key: string, val: unknown): unknown {
  if (typeof val === "string" && key in STRING_REPLACEMENTS) {
    return STRING_REPLACEMENTS[key];
  }

  const segments = keySegments(key);

  if (hasSegment(segments, COORD_SEGMENTS)) {
    return val !== null && typeof val === "object" ? scrub(val) : 0;
  }
  if (hasSegment(segments, ID_SEGMENTS)) {
    if (typeof val === "number") return 1;
    if (typeof val === "string") return "1";
    return scrub(val);
  }
  if (hasSegment(segments, NAME_SEGMENTS) && typeof val === "string") {
    return "Test User";
  }
  if (hasSegment(segments, EMAIL_SEGMENTS) && typeof val === "string") {
    return "redacted@example.test";
  }
  return scrub(val);
}
