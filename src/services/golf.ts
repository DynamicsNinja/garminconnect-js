import { GarminError } from "../errors.js";
import type { GarminClient } from "../client.js";
import { validateNonNegativeInteger, validatePositiveInteger, pathSegment } from "../util/validate.js";
import type {
  GolfClubStats,
  GolfScorecardDetail,
  GolfScorecardSummary,
  GolfShotData,
  GolfUserStats,
} from "../types/golf.js";

/** Golf: scorecard summaries/details, shot data, club stats, handicap/strokes-gained overview. */
export interface GolfHost {
  readonly client: GarminClient;
}

/**
 * Passes Garmin's response through unchecked. Query params are literally hyphenated (`per-page`,
 * not `perPage`) — this is Garmin's own param naming, not a typo.
 *
 * Returns a single pagination-envelope OBJECT (`{pageNumber, rowsPerPage, totalRows}`), not an
 * array — live-verified on the test account; see `GolfScorecardSummary` in `src/types/golf.ts`.
 */
export async function getGolfSummary(
  host: GolfHost,
  start = 0,
  limit = 100,
): Promise<GolfScorecardSummary | null> {
  validateNonNegativeInteger(start, "start");
  validatePositiveInteger(limit, "limit");
  return host.client.connectapi<GolfScorecardSummary>(
    "/gcs-golfcommunity/api/v2/scorecard/summary",
    { params: { "per-page": limit, start } },
  );
}

/**
 * Passes Garmin's response through unchecked. Both query params are literally hyphenated:
 * `scorecard-ids` and `include-longest-shot-distance` (sent as the literal string `"true"`, not a
 * JSON boolean).
 */
export async function getGolfScorecard(
  host: GolfHost,
  scorecardId: number | string,
): Promise<GolfScorecardDetail | null> {
  return host.client.connectapi<GolfScorecardDetail>(
    "/gcs-golfcommunity/api/v2/scorecard/detail",
    {
      params: {
        "scorecard-ids": String(scorecardId),
        "include-longest-shot-distance": "true",
      },
    },
  );
}

const HOLE_NUMBER_RE = /^\d+$/;
const MIN_HOLE = 1;
const MAX_HOLE = 18;

/**
 * Strips spaces, accepts commas or hyphens as separators between individual hole numbers, then
 * re-joins with `-` (Garmin's API only accepts `-`). Returns `undefined` (not the normalized
 * string) when any requested hole number is >9, because Garmin's endpoint silently drops
 * double-digit hole numbers from a filtered query — the filter is dropped and all 18 holes are
 * requested unfiltered. No warning is logged; the caller's own logging (if any) can note it, rather
 * than a console.warn a library shouldn't own.
 *
 * Every token must be a hole in 1-18. The range check runs BEFORE the
 * >9 drop-filter, and the ordering is load-bearing: without it, a typo like `"19"` or `"100"` would
 * fall into the >9 branch and silently fetch ALL EIGHTEEN holes instead of raising. A caller's
 * mistake must fail loudly, not quietly widen the query's scope.
 */
function normalizeHoleNumbers(holeNumbers: string): string | undefined {
  const stripped = holeNumbers.replace(/\s+/g, "");
  if (stripped.length === 0) {
    throw new GarminError(`Invalid holeNumbers: "${holeNumbers}"`);
  }
  const tokens = stripped.split(/[,-]/);
  const numbers = tokens.map((token) => {
    if (!HOLE_NUMBER_RE.test(token)) {
      throw new GarminError(`Invalid holeNumbers: "${holeNumbers}"`);
    }
    const n = Number(token);
    if (n < MIN_HOLE || n > MAX_HOLE) {
      throw new GarminError(
        `Invalid holeNumbers: "${holeNumbers}" — holes must be ${MIN_HOLE}-${MAX_HOLE}, got ${n}`,
      );
    }
    return n;
  });
  if (numbers.some((n) => n > 9)) {
    return undefined;
  }
  return numbers.join("-");
}

/**
 * Passes Garmin's response through unchecked. `holeNumbers` is normalized via
 * `normalizeHoleNumbers`: commas/hyphens accepted as input separators, spaces stripped, re-joined
 * with `-`. **Special case**: if any requested hole number is >9 (10-18), the filter is silently
 * dropped and all 18 holes are fetched instead (Garmin's endpoint drops double-digit hole numbers
 * from a filtered query). The filter is sent as a `{ "hole-numbers": value }` params entry, which
 * composes into `hole-numbers={value}` via this client's `URLSearchParams`-based query builder.
 */
export async function getGolfShotData(
  host: GolfHost,
  scorecardId: number | string,
  holeNumbers?: string,
): Promise<GolfShotData | null> {
  const normalized = holeNumbers === undefined ? undefined : normalizeHoleNumbers(holeNumbers);
  return host.client.connectapi<GolfShotData>(
    `/gcs-golfcommunity/api/v2/shot/scorecard/${pathSegment(scorecardId)}/hole`,
    normalized === undefined ? {} : { params: { "hole-numbers": normalized } },
  );
}

/**
 * Passes Garmin's response through unchecked. Query params are literally hyphenated (`per-page`)
 * with `include-stats` sent as the literal string `"true"`.
 *
 * Returns a JSON ARRAY, not a single object — live-verified on the test account, which returned
 * 17 club entries; see `GolfClubStats` in `src/types/golf.ts`.
 */
export async function getGolfClubStats(
  host: GolfHost,
  limit = 1000,
): Promise<GolfClubStats[] | null> {
  validatePositiveInteger(limit, "limit");
  return host.client.connectapi<GolfClubStats[]>("/gcs-golfcommunity/api/v2/club/player", {
    params: { "per-page": limit, "include-stats": "true" },
  });
}

/**
 * Handicap and strokes-gained overview. Passes Garmin's response through unchecked. No
 * parameters.
 */
export async function getGolfUserStats(host: GolfHost): Promise<GolfUserStats | null> {
  return host.client.connectapi<GolfUserStats>("/gcs-golfcommunity/api/v2/player/stats");
}
