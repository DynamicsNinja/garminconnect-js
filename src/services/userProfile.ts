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

/** What `hasConnectPlus` needs: the cached social profile `Garmin.getUserProfile()` returns. */
export interface ConnectPlusHost {
  getUserProfile(): Promise<{ [key: string]: unknown }>;
}

/**
 * Whether the account has a Garmin Connect+ subscription, read from the user profile
 * (`/userprofile-service/socialProfile`, which `Garmin` caches, so this usually costs no request).
 *
 * Two signals in that profile, compared live on 2026-10-06 between an account with Connect+ and
 * one without: `hasPremiumSocialIcon` (true only with Connect+) and the `ROLE_SP_FEATURE_n` entries
 * in `userRoles` (eleven of them with Connect+, none without). Either one counts.
 */
export async function hasConnectPlus(host: ConnectPlusHost): Promise<boolean> {
  const profile = await host.getUserProfile();
  if (profile["hasPremiumSocialIcon"] === true) return true;
  const roles = profile["userRoles"];
  return Array.isArray(roles) && roles.some((r) => typeof r === "string" && r.startsWith("ROLE_SP_FEATURE_"));
}
