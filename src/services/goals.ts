import { GarminError } from "../errors.js";
import type { GarminClient } from "../client.js";
import type { Goal, GoalStatus } from "../types/goals.js";

export interface GoalsHost {
  readonly client: GarminClient;
}

/** Matches upstream's `MAX_PAGINATED_REQUESTS` safety cap (same value used by `getActivitiesByDate`). */
const MAX_PAGINATED_REQUESTS = 2000;

const VALID_STATUSES: readonly GoalStatus[] = ["active", "future", "past"];

/**
 * Upstream `get_goals`. `status` must be one of `active`/`future`/`past` or this throws
 * `GarminError` before any request (mirroring upstream's `ValueError`).
 *
 * **Paginated, same fixed-page-size pattern as `getActivitiesByDate`** (see
 * `src/services/activities.ts`): starting from the caller's `start`, it fetches pages of `limit`
 * entries, incrementing `start` by `limit` each call, until a page comes back empty/falsy (the
 * normal end of data) or `MAX_PAGINATED_REQUESTS` pages have been fetched without ever seeing one
 * — the latter throws `GarminError` (mirroring upstream's `GarminConnectConnectionError`), matching
 * `getActivitiesByDate`'s abort-with-error safety cap.
 *
 * **`Sec-Fetch-Site: same-origin` is LOAD-BEARING and sent on every request.** Without it,
 * `goal-service` silently returns `[]` for newer custom accumulation-goal types (upstream cites
 * issue #431) — no error, no 404, just wrong (empty) data. Do not drop this header.
 */
export async function getGoals(
  host: GoalsHost,
  status: GoalStatus = "active",
  start = 0,
  limit = 30,
): Promise<Goal[]> {
  if (!VALID_STATUSES.includes(status)) {
    throw new GarminError(
      `Invalid goal status "${status}" — must be one of ${VALID_STATUSES.join(", ")}`,
    );
  }

  const results: Goal[] = [];
  let currentStart = start;
  let sawEmptyPage = false;

  for (let page = 0; page < MAX_PAGINATED_REQUESTS; page++) {
    const batch = await host.client.connectapi<Goal[]>("/goal-service/goal/goals", {
      params: { status, start: currentStart, limit, sortOrder: "asc" },
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    if (!batch || batch.length === 0) {
      sawEmptyPage = true;
      break;
    }
    results.push(...batch);
    currentStart += limit;
  }

  if (!sawEmptyPage) {
    throw new GarminError(`Pagination exceeded ${MAX_PAGINATED_REQUESTS} requests; aborting`);
  }
  return results;
}
