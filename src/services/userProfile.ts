import type { GarminClient } from "../client.js";
import type { UserprofileSettings } from "../types/userProfile.js";

/**
 * This file covers the `userProfile` inventory section, minus the three rows that already have a
 * live-verified equivalent elsewhere in this port under a different name:
 *
 * | upstream           | already exists as                                                       |
 * |---------------------|--------------------------------------------------------------------------|
 * | `get_full_name`      | `Garmin.fullName()` (cached accessor, no HTTP call)                     |
 * | `get_unit_system`     | `Garmin.unitSystem()` (cached accessor, no HTTP call)                   |
 * | `get_user_profile`    | `Garmin.getUserSettings()` — SAME endpoint (`user-settings`), different name |
 *
 * **Ruling (Task 12):** no aliases were added for these three. Upstream's `get_user_profile` name
 * collides with this port's PRE-EXISTING `getUserProfile()`, which hits a DIFFERENT endpoint
 * (`/userprofile-service/socialProfile`) and is cached/relied upon by `displayName()`/`fullName()`/
 * `userName()` and every date-scoped method in the library. Repointing it, or adding a second method
 * with a near-identical name pointing at `user-settings`, would either break that caching chain or
 * create two ways to call the same endpoint. The mapping above is the resolution: callers porting
 * upstream code that calls `get_user_profile()`/`get_full_name()`/`get_unit_system()` should call
 * `getUserSettings()`/`fullName()`/`unitSystem()` instead. See `AGENTS.md` section 3 for the same
 * table in the published method inventory.
 *
 * That leaves one genuinely new method here: `getUserprofileSettings`.
 */
export interface UserProfileHost {
  readonly client: GarminClient;
}

/**
 * Upstream `get_userprofile_settings`. Hits `/userprofile-service/userprofile/settings` — SINGULAR
 * "settings", NOT the hyphenated "user-settings" that `Garmin.getUserSettings()` already uses. The
 * two paths are one character apart and easy to transpose; the test for this method asserts the
 * literal URL for exactly that reason. `null_behaviour`: passes through unchecked, per the
 * inventory.
 */
export async function getUserprofileSettings(
  host: UserProfileHost,
): Promise<UserprofileSettings | null> {
  return host.client.connectapi<UserprofileSettings>("/userprofile-service/userprofile/settings");
}
