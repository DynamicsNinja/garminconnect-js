/**
 * One entry of `GET /badge-service/badge/earned` (`get_earned_badges`) and
 * `GET /badge-service/badge/available` (`get_available_badges`) — both endpoints return a JSON
 * ARRAY of badge objects, matching the inventory's `list` return type for both rows. The fields
 * below are the ones `getInProgressBadges` (`src/services/badges.ts`) actually reads to replicate
 * upstream's `is_badge_in_progress` predicate and the `badgeId`-keyed merge; everything else is an
 * honest index signature since Garmin's badge payload is otherwise undocumented.
 */
export interface Badge {
  badgeId?: number;
  badgeProgressValue?: number;
  badgeTargetValue?: number;
  badgeLimitCount?: number;
  badgeEarnedNumber?: number;
  /** Added by this library, not sent by Garmin — see `BadgeImageUrls`. */
  badgeImageUrls?: BadgeImageUrls;
  [key: string]: unknown;
}

/**
 * The badge's artwork. NOT part of Garmin's payload, which carries no image URL at all: this
 * library adds it, built the way Garmin Connect's own web app builds it —
 * `https://connect.garmin.com/images/badges/xxhdpi/badge_<badgeUuid ?? badgeId>_<sml|lrg>.png`.
 * `badgeUuid` is set on newer challenge badges; the classic ones use `badgeId`. Public PNGs, no
 * session needed. Live-verified 2026-09-24: all 732 URLs for one account's 23 earned and 343
 * available badges returned 200 (`small` ~198×231, `xxhdpi`). Absent when a badge has neither id.
 */
export interface BadgeImageUrls {
  small: string;
  large: string;
}

/**
 * One entry of `BadgeDetail.relatedBadges`: the other badges in the same series (for `run_5km`:
 * the 1 mile, 10K, half and full marathon badges), each flagged with whether the caller has it.
 * Every field observed on a real account on 2026-09-24.
 */
export interface RelatedBadge {
  badgeId?: number;
  badgeKey?: string;
  badgeUuid?: string | null;
  badgeName?: string;
  badgeDifficultyId?: number;
  badgePoints?: number;
  badgeTypeIds?: number[];
  earnedByMe?: boolean;
  badgeCategoryId?: number;
  /** Added by this library, not sent by Garmin — see `BadgeImageUrls`. */
  badgeImageUrls?: BadgeImageUrls;
  [key: string]: unknown;
}

/**
 * `GET /badge-service/badge/detail/v3/{badgeId}` — what Garmin Connect's web app loads when you
 * open a badge. The same fields as a `getEarnedBadges` row, plus the series and the activity that
 * earned it. The fields named here were read off a real account on 2026-09-24 (an activity badge,
 * a monthly challenge badge, and an unearned badge); the rest stay on the index signature.
 *
 * There is NO description text and NO image URL in Garmin's payload. This library adds the
 * artwork as `badgeImageUrls` (here and on every `relatedBadges` entry). The text Garmin's web app
 * takes from the public
 * `https://connect.garmin.com/web-translations/badges-list/badges-list.properties`, keyed
 * `badge_description_<badgeKey>`.
 */
export interface BadgeDetail extends Badge {
  badgeKey?: string;
  badgeName?: string;
  /** Set on newer challenge badges, null on the classic ones. */
  badgeUuid?: string | null;
  badgeCategoryId?: number;
  badgeDifficultyId?: number;
  badgePoints?: number;
  badgeSeriesId?: number | null;
  /** `YYYY-MM-DDTHH:MM:SS.S`, local; null when the caller hasn't earned it. */
  badgeEarnedDate?: string | null;
  earnedByMe?: boolean;
  /** The window a challenge badge can be earned in; `badgeEndDate` is null for permanent badges. */
  badgeStartDate?: string | null;
  badgeEndDate?: string | null;
  /**
   * What `badgeAssocDataId` points at: `"activityId"` (the activity that earned it, named in
   * `badgeAssocDataName`) or `"none"`. Observed: `"none"` on a challenge badge, whose
   * `badgeAssocDataId` then repeats its `badgeUuid`.
   */
  badgeAssocType?: string;
  badgeAssocDataId?: string | null;
  badgeAssocDataName?: string | null;
  /** The rest of the badge's series; `[]` for a one-off challenge badge. */
  relatedBadges?: RelatedBadge[] | null;
  /** People the caller follows who have this badge. */
  followings?: unknown[];
  followingNumber?: number;
}

/**
 * One entry of `GET /adhocchallenge-service/adHocChallenge/historical` (`get_adhoc_challenges`).
 * The inventory lists this row's `returns` column as `dict`, but the live test account
 * (Task 9 smoke run) returned a JSON ARRAY, not a single object — the same "dict-labelled but
 * actually an array" gotcha already seen twice in `src/types/gear.ts` (Task 7). Typed as an array
 * accordingly; `getAdhocChallenges` returns `AdhocChallenge[] | null`.
 */
export interface AdhocChallenge {
  [key: string]: unknown;
}

/**
 * One entry of `GET /badgechallenge-service/badgeChallenge/completed` (`get_badge_challenges`).
 * Same "dict-labelled but actually an array" correction as `AdhocChallenge` — live-verified as a
 * JSON array. `getBadgeChallenges` returns `BadgeChallenge[] | null`.
 */
export interface BadgeChallenge {
  [key: string]: unknown;
}

/**
 * One entry of `GET /badgechallenge-service/badgeChallenge/available`
 * (`get_available_badge_challenges`). Same "dict-labelled but actually an array" correction —
 * live-verified as a JSON array (the live account returned real challenge entries, e.g.
 * `badgeChallengeName: "Ahotu Marathon Challenge"`). `getAvailableBadgeChallenges` returns
 * `AvailableBadgeChallenge[] | null`.
 */
export interface AvailableBadgeChallenge {
  [key: string]: unknown;
}

/**
 * One entry of `GET /badgechallenge-service/badgeChallenge/non-completed`
 * (`get_non_completed_badge_challenges`). Same "dict-labelled but actually an array" correction —
 * live-verified as a JSON array. `getNonCompletedBadgeChallenges` returns
 * `NonCompletedBadgeChallenge[] | null`.
 */
export interface NonCompletedBadgeChallenge {
  [key: string]: unknown;
}

/**
 * One entry of `GET /badgechallenge-service/virtualChallenge/inProgress`
 * (`get_inprogress_virtual_challenges`). Same "dict-labelled but actually an array" correction —
 * live-verified as a JSON array. `getInprogressVirtualChallenges` returns
 * `InprogressVirtualChallenge[] | null`.
 */
export interface InprogressVirtualChallenge {
  [key: string]: unknown;
}
