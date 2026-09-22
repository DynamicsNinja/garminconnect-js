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

const NUMBER_REPLACEMENTS: Record<string, number> = {
  profileId: 1,
  userProfileId: 1,
  startLatitude: 0,
  startLongitude: 0,
  endLatitude: 0,
  endLongitude: 0,
  latitude: 0,
  longitude: 0,
};

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/** Removes personal data so a recorded fixture is safe to commit. */
export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value === null || typeof value !== "object") {
    return typeof value === "string" ? value.replace(EMAIL, "redacted@example.test") : value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "string" && key in STRING_REPLACEMENTS) {
      out[key] = STRING_REPLACEMENTS[key];
    } else if (typeof val === "number" && key in NUMBER_REPLACEMENTS) {
      out[key] = NUMBER_REPLACEMENTS[key];
    } else {
      out[key] = scrub(val);
    }
  }
  return out;
}
