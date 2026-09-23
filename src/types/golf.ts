/**
 * `GET /gcs-golfcommunity/api/v2/scorecard/summary` (`get_golf_summary`). The inventory's
 * `returns` column says "list" for this one — live-verified WRONG, the same direction most of
 * this project's `dict` mislabels are, just inverted: the test account (0 rounds recorded)
 * returned a single pagination-envelope OBJECT, `{"pageNumber":1,"rowsPerPage":10,"totalRows":0}`,
 * not an array. `getGolfSummary` in `src/services/golf.ts` returns `GolfScorecardSummary | null`
 * accordingly. Kept as an honest index signature since the field list for a non-empty result
 * (i.e. what the row/scorecard entries look like once `totalRows > 0`) has never been observed.
 */
export interface GolfScorecardSummary {
  [key: string]: unknown;
}

/**
 * `GET /gcs-golfcommunity/api/v2/scorecard/detail` (`get_golf_scorecard`). Passes through
 * unchecked; undocumented shape.
 */
export interface GolfScorecardDetail {
  [key: string]: unknown;
}

/**
 * `GET /gcs-golfcommunity/api/v2/shot/scorecard/{scorecardId}/hole` (`get_golf_shot_data`).
 * Passes through unchecked; undocumented shape.
 */
export interface GolfShotData {
  [key: string]: unknown;
}

/**
 * One entry of `GET /gcs-golfcommunity/api/v2/club/player` (`get_golf_club_stats`) —
 * live-verified as a JSON ARRAY on the test account (17 club entries, each shaped roughly
 * `{id, clubTypeId, shaftLength, flexTypeId, averageDistance, adviceDistance, retired, deleted,
 * lastModifiedTime}`), despite the inventory listing its return type as "dict". `getGolfClubStats`
 * in `src/services/golf.ts` returns `GolfClubStats[] | null` accordingly. Kept as an honest index
 * signature per entry rather than a guessed exhaustive shape.
 */
export interface GolfClubStats {
  [key: string]: unknown;
}

/**
 * `GET /gcs-golfcommunity/api/v2/player/stats` (`get_golf_user_stats`). Handicap and
 * strokes-gained overview. Passes through unchecked; undocumented shape.
 */
export interface GolfUserStats {
  [key: string]: unknown;
}
