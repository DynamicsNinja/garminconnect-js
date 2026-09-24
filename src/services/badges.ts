import type { GarminClient } from "../client.js";
import type {
  AdhocChallenge,
  AvailableBadgeChallenge,
  Badge,
  BadgeChallenge,
  BadgeDetail,
  InprogressVirtualChallenge,
  NonCompletedBadgeChallenge,
} from "../types/badges.js";
import { validateNonNegativeInteger, validatePositiveInteger } from "../util/validate.js";

export interface BadgesHost {
  readonly client: GarminClient;
}

/** Upstream `get_earned_badges`. Passes through unchecked — stays nullable, not coalesced. */
export async function getEarnedBadges(host: BadgesHost): Promise<Badge[] | null> {
  return host.client.connectapi<Badge[]>("/badge-service/badge/earned");
}

/** Upstream `get_available_badges`. Passes through unchecked — stays nullable, not coalesced. */
export async function getAvailableBadges(host: BadgesHost): Promise<Badge[] | null> {
  return host.client.connectapi<Badge[]>("/badge-service/badge/available", {
    params: { showExclusiveBadge: "true" },
  });
}

/**
 * NOT upstream parity: upstream has no per-badge call. `GET /badge-service/badge/detail/v3/{id}`
 * is what Garmin Connect's web app requests when a badge is opened (it adds
 * `followingLimit=7`, which only caps `followings` and is left out here). Works for badges the
 * caller has not earned. An unknown id is a 400 `GarminHttpError` from Garmin, not a 404.
 */
export async function getBadgeDetail(host: BadgesHost, badgeId: number): Promise<BadgeDetail | null> {
  const id = validatePositiveInteger(badgeId, "badgeId");
  return host.client.connectapi<BadgeDetail>(`/badge-service/badge/detail/v3/${id}`);
}

/**
 * Mirrors upstream's nested `is_badge_in_progress`: a badge counts as "in progress" when its
 * progress is truthy (non-zero) AND either it hasn't reached its target yet, or — having reached
 * the target — it has a `badgeLimitCount` (a repeatable badge) that has not yet been fully earned
 * (`badgeEarnedNumber < badgeLimitCount`).
 */
function isBadgeInProgress(badge: Badge): boolean {
  const progress = badge.badgeProgressValue;
  if (!progress) return false;
  const target = badge.badgeTargetValue;
  if (progress === target) {
    if (badge.badgeLimitCount == null) return false;
    return (badge.badgeEarnedNumber ?? 0) < badge.badgeLimitCount;
  }
  return true;
}

/**
 * Upstream `get_in_progress_badges` has no HTTP path of its own. It calls `get_earned_badges()`
 * and `get_available_badges()` (in that order), filters each list with `is_badge_in_progress`,
 * then merges the two filtered lists into a dict keyed by `badgeId` — `available` overwrites
 * `earned` on a key collision — and returns `list(combined.values())`. Never raises: if either
 * upstream call returns `null` (204/empty body), that side is treated as an empty list rather than
 * throwing, matching the inventory's "never raises ... tolerant of missing keys" note.
 */
export async function getInProgressBadges(host: BadgesHost): Promise<Badge[]> {
  const [earned, available] = await Promise.all([getEarnedBadges(host), getAvailableBadges(host)]);

  const earnedInProgress = (earned ?? []).filter(isBadgeInProgress);
  const availableInProgress = (available ?? []).filter(isBadgeInProgress);

  const combined = new Map<number | undefined, Badge>();
  for (const badge of earnedInProgress) combined.set(badge.badgeId, badge);
  for (const badge of availableInProgress) combined.set(badge.badgeId, badge);
  return Array.from(combined.values());
}

/**
 * Upstream `get_adhoc_challenges`: `start` validated non-negative, `limit` validated positive.
 * Passes through unchecked — stays nullable. The inventory labels the `returns` column `dict`,
 * but the live test account (Task 9 smoke run) returned a JSON array — see the file-level comment
 * in `src/types/badges.ts`.
 */
export async function getAdhocChallenges(
  host: BadgesHost,
  start: number,
  limit: number,
): Promise<AdhocChallenge[] | null> {
  const validStart = validateNonNegativeInteger(start, "start");
  const validLimit = validatePositiveInteger(limit, "limit");
  return host.client.connectapi<AdhocChallenge[]>(
    "/adhocchallenge-service/adHocChallenge/historical",
    { params: { start: validStart, limit: validLimit } },
  );
}

/**
 * Upstream `get_badge_challenges`: `start` validated non-negative, `limit` validated positive.
 * Passes through unchecked — stays nullable. Live-verified as a JSON array (see
 * `src/types/badges.ts`), not the `dict` the inventory's `returns` column names.
 */
export async function getBadgeChallenges(
  host: BadgesHost,
  start: number,
  limit: number,
): Promise<BadgeChallenge[] | null> {
  const validStart = validateNonNegativeInteger(start, "start");
  const validLimit = validatePositiveInteger(limit, "limit");
  return host.client.connectapi<BadgeChallenge[]>(
    "/badgechallenge-service/badgeChallenge/completed",
    { params: { start: validStart, limit: validLimit } },
  );
}

/**
 * Upstream `get_available_badge_challenges`: `start` validated non-negative, `limit` validated
 * positive. Passes through unchecked — stays nullable. Live-verified as a JSON array (see
 * `src/types/badges.ts`), not the `dict` the inventory's `returns` column names.
 */
export async function getAvailableBadgeChallenges(
  host: BadgesHost,
  start: number,
  limit: number,
): Promise<AvailableBadgeChallenge[] | null> {
  const validStart = validateNonNegativeInteger(start, "start");
  const validLimit = validatePositiveInteger(limit, "limit");
  return host.client.connectapi<AvailableBadgeChallenge[]>(
    "/badgechallenge-service/badgeChallenge/available",
    { params: { start: validStart, limit: validLimit } },
  );
}

/**
 * Upstream `get_non_completed_badge_challenges`: `start` validated non-negative, `limit`
 * validated positive. Passes through unchecked — stays nullable. Live-verified as a JSON array
 * (see `src/types/badges.ts`), not the `dict` the inventory's `returns` column names.
 */
export async function getNonCompletedBadgeChallenges(
  host: BadgesHost,
  start: number,
  limit: number,
): Promise<NonCompletedBadgeChallenge[] | null> {
  const validStart = validateNonNegativeInteger(start, "start");
  const validLimit = validatePositiveInteger(limit, "limit");
  return host.client.connectapi<NonCompletedBadgeChallenge[]>(
    "/badgechallenge-service/badgeChallenge/non-completed",
    { params: { start: validStart, limit: validLimit } },
  );
}

/**
 * Upstream `get_inprogress_virtual_challenges`. **Asymmetric validation**: unlike the four
 * challenge-listing methods above, `start` here is validated as POSITIVE (rejecting `start=0`),
 * not merely non-negative — an easy detail to miss when porting a "generic pagination" helper.
 * `limit` validated positive, same as the others. Passes through unchecked — stays nullable.
 * Live-verified as a JSON array (see `src/types/badges.ts`), not the `dict` the inventory's
 * `returns` column names.
 */
export async function getInprogressVirtualChallenges(
  host: BadgesHost,
  start: number,
  limit: number,
): Promise<InprogressVirtualChallenge[] | null> {
  const validStart = validatePositiveInteger(start, "start");
  const validLimit = validatePositiveInteger(limit, "limit");
  return host.client.connectapi<InprogressVirtualChallenge[]>(
    "/badgechallenge-service/virtualChallenge/inProgress",
    { params: { start: validStart, limit: validLimit } },
  );
}
