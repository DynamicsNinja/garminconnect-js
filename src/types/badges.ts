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
  [key: string]: unknown;
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
