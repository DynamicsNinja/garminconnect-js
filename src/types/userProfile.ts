/**
 * `GET /userprofile-service/userprofile/settings` (upstream `get_userprofile_settings`).
 * Distinct from `UserSettings` in `src/garmin.ts`, which is
 * `/userprofile-service/userprofile/user-settings` (note the SINGULAR "settings" here vs. the
 * hyphenated "user-settings" there — the two paths are trivially transposable). Not live-verified
 * against a documented shape beyond "some object comes back"; kept as an honest index signature.
 */
export interface UserprofileSettings {
  [key: string]: unknown;
}
