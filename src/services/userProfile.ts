import type { GarminClient } from "../client.js";
import type { UserprofileSettings } from "../types/userProfile.js";

/**
 * User-profile settings. The other profile reads live on `Garmin` itself:
 *
 * | need                     | method                                                          |
 * |--------------------------|-----------------------------------------------------------------|
 * | full name                | `Garmin.fullName()` (cached accessor, no HTTP call)             |
 * | unit system              | `Garmin.unitSystem()` (cached accessor, no HTTP call)           |
 * | user settings            | `Garmin.getUserSettings()` (`/userprofile/user-settings`)       |
 *
 * `getUserProfile()` hits a DIFFERENT endpoint (`/userprofile-service/socialProfile`) and is
 * cached/relied upon by `displayName()`/`fullName()`/`userName()` and every date-scoped method in
 * the library. Do not repoint it at `user-settings`, or add a second method with a near-identical
 * name pointing there: that would either break the caching chain or create two ways to call the
 * same endpoint.
 */
export interface UserProfileHost {
  readonly client: GarminClient;
}

/**
 * Hits `/userprofile-service/userprofile/settings` — SINGULAR
 * "settings", NOT the hyphenated "user-settings" that `Garmin.getUserSettings()` already uses. The
 * two paths are one character apart and easy to transpose; the test for this method asserts the
 * literal URL for exactly that reason. Passes Garmin's response through unchecked.
 */
export async function getUserprofileSettings(
  host: UserProfileHost,
): Promise<UserprofileSettings | null> {
  return host.client.connectapi<UserprofileSettings>("/userprofile-service/userprofile/settings");
}
