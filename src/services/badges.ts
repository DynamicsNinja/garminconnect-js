import type { GarminClient } from "../client.js";
import type {
  AdhocChallenge,
  AvailableBadgeChallenge,
  Badge,
  BadgeChallenge,
  BadgeDetail,
  BadgeImageUrls,
  InprogressVirtualChallenge,
  NonCompletedBadgeChallenge,
} from "../types/badges.js";
import { validateNonNegativeInteger, validatePositiveInteger } from "../util/validate.js";

export interface BadgesHost {
  readonly client: GarminClient;
}

const BADGE_IMAGES = "https://connect.garmin.com/images/badges/xxhdpi";

/**
 * Garmin sends no image URL; its web app builds one from `badgeUuid` (newer challenge badges) or
 * `badgeId`. Same here, both sizes. A key that isn't plain alphanumeric is refused rather than
 * interpolated into a URL.
 */
function imageUrls(badge: { badgeId?: unknown; badgeUuid?: unknown }): BadgeImageUrls | undefined {
  const uuid = typeof badge.badgeUuid === "string" ? badge.badgeUuid : "";
  const id = typeof badge.badgeId === "number" && Number.isInteger(badge.badgeId) ? String(badge.badgeId) : "";
  const key = uuid || id;
  if (!/^[A-Za-z0-9]+$/.test(key)) return undefined;
  return { small: `${BADGE_IMAGES}/badge_${key}_sml.png`, large: `${BADGE_IMAGES}/badge_${key}_lrg.png` };
}

/** Returns a copy with `badgeImageUrls` set, or the badge unchanged when there is no id. */
function withImageUrls<T extends { badgeId?: unknown; badgeUuid?: unknown }>(badge: T): T {
  if (!badge || typeof badge !== "object") return badge;
  const urls = imageUrls(badge);
  return urls ? { ...badge, badgeImageUrls: urls } : badge;
}

function listWithImageUrls(badges: Badge[] | null): Badge[] | null {
  return Array.isArray(badges) ? badges.map(withImageUrls) : badges;
}

/**
 * Stays nullable, not coalesced. Each badge gains `badgeImageUrls`,
 * which Garmin does not send; everything else passes through unchanged.
 */
export async function getEarnedBadges(host: BadgesHost): Promise<Badge[] | null> {
  return listWithImageUrls(await host.client.connectapi<Badge[]>("/badge-service/badge/earned"));
}

/**
 * Stays nullable, not coalesced. Each badge gains
 * `badgeImageUrls`, which Garmin does not send; everything else passes through unchanged.
 */
export async function getAvailableBadges(host: BadgesHost): Promise<Badge[] | null> {
  return listWithImageUrls(
    await host.client.connectapi<Badge[]>("/badge-service/badge/available", {
      params: { showExclusiveBadge: "true" },
    }),
  );
}

/**
 * `GET /badge-service/badge/detail/v3/{id}`
 * is what Garmin Connect's web app requests when a badge is opened (it adds
 * `followingLimit=7`, which only caps `followings` and is left out here). Works for badges the
 * caller has not earned. An unknown id is a 400 `GarminHttpError` from Garmin, not a 404. The badge
 * and each of its `relatedBadges` gain `badgeImageUrls`, which Garmin does not send.
 */
export async function getBadgeDetail(host: BadgesHost, badgeId: number): Promise<BadgeDetail | null> {
  const id = validatePositiveInteger(badgeId, "badgeId");
  const detail = await host.client.connectapi<BadgeDetail>(`/badge-service/badge/detail/v3/${id}`);
  if (!detail || typeof detail !== "object") return detail;
  const related = Array.isArray(detail.relatedBadges) ? detail.relatedBadges.map(withImageUrls) : detail.relatedBadges;
  return { ...withImageUrls(detail), relatedBadges: related };
}

/**
 * A badge counts as "in progress" when its progress is truthy (non-zero) AND either it hasn't
 * reached its target yet, or — having reached
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
 * Has no HTTP path of its own. It calls `getEarnedBadges()` and `getAvailableBadges()`, filters
 * each list with `isBadgeInProgress`, then merges the two filtered lists into a map keyed by
 * `badgeId` — `available` overwrites `earned` on a key collision — and returns its values. Never
 * raises: if either call returns `null` (204/empty body), that side is treated as an empty list
 * rather than throwing.
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
 * `start` validated non-negative, `limit` validated positive. Passes through unchecked — stays
 * nullable. Live-verified as a JSON array — see the file-level comment in `src/types/badges.ts`.
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
 * `start` validated non-negative, `limit` validated positive. Passes through unchecked — stays
 * nullable. Live-verified as a JSON array (see `src/types/badges.ts`).
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
 * `start` validated non-negative, `limit` validated positive. Passes through unchecked — stays
 * nullable. Live-verified as a JSON array (see `src/types/badges.ts`).
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
 * `start` validated non-negative, `limit` validated positive. Passes through unchecked — stays
 * nullable. Live-verified as a JSON array (see `src/types/badges.ts`).
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
 * **Asymmetric validation**: unlike the four challenge-listing methods above, `start` here is
 * validated as POSITIVE (rejecting `start=0`), not merely non-negative — an easy detail to miss
 * when reaching for a "generic pagination" helper. `limit` validated positive, same as the others.
 * Passes through unchecked — stays nullable. Live-verified as a JSON array (see
 * `src/types/badges.ts`).
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
