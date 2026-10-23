import type { UserSettingsDTO } from "../generated/personal-api.js";

/**
 * `GET /userprofile-service/userprofile/settings`.
 * Distinct from `UserSettings` in `src/garmin.ts`, which is
 * `/userprofile-service/userprofile/user-settings` (note the SINGULAR "settings" here vs. the
 * hyphenated "user-settings" there — the two paths are trivially transposable). Fields from
 * Garmin's Personal API spec (`PersonalApi.UserSettingsDTO`), which documents this same path.
 */
export interface UserprofileSettings extends UserSettingsDTO {}
