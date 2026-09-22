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
 */

// Fixed replacements for specific keys, applied before the generic
// patterns below so callers get nicer, recognizable fixture values.
const STRING_REPLACEMENTS: Record<string, string> = {
  fullName: "Test User",
  userName: "testuser",
  displayName: "abc-display",
  firstName: "Test",
  lastName: "User",
  access_token: "redacted",
  refresh_token: "redacted",
  oauth_token: "redacted",
  oauth_token_secret: "redacted",
  mfa_token: "redacted",
  jti: "redacted",
};

// Generic, case-insensitive key patterns. These catch the many field-name
// variants Garmin uses across endpoints (startLatitudeDegrees, beginLatitude,
// lat/lon/lng in lap and trackpoint arrays, ownerFullName, activityName, …)
// that an exact-key allowlist can never fully enumerate.
const COORD_KEY = /latitude|longitude/i;
const COORD_SHORT_KEY = /^(lat|lon|lng)$/i;
const NAME_KEY = /name/i;
const EMAIL_KEY = /email/i;
const ID_KEY = /(id|pk)$/i;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

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
  if (COORD_KEY.test(key) || COORD_SHORT_KEY.test(key)) {
    return val !== null && typeof val === "object" ? scrub(val) : 0;
  }
  if (ID_KEY.test(key)) {
    if (typeof val === "number") return 1;
    if (typeof val === "string") return "1";
    return scrub(val);
  }
  if (NAME_KEY.test(key) && typeof val === "string") {
    return "Test User";
  }
  if (EMAIL_KEY.test(key) && typeof val === "string") {
    return "redacted@example.test";
  }
  return scrub(val);
}
