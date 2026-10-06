import { pathSegment } from "../util/validate.js";
import type { GarminClient } from "../client.js";
import { formatDate } from "../util/date.js";
import type { GraphqlResult, LifestyleLoggingData, ReloadRequestResult } from "../types/misc.js";

/**
 * Miscellaneous methods: lifestyle-logging data, the "request a reload" write, the raw
 * GraphQL gateway passthrough, and `logout`. `logout` is the only member with no HTTP call.
 */
export interface MiscHost {
  readonly client: GarminClient;
}

/**
 * Passes Garmin's response through unchecked.
 */
export async function getLifestyleLoggingData(
  host: MiscHost,
  cdate: string | Date,
): Promise<LifestyleLoggingData | null> {
  return host.client.connectapi<LifestyleLoggingData>(
    `/lifestylelogging-service/dailyLog/${pathSegment(formatDate(cdate))}`,
  );
}

/**
 * A WRITE: asks Garmin to reload/recompute a day's data (Garmin offloads older data, so this is
 * how a caller forces it back). Sent with no JSON body.
 *
 * Returns Garmin's raw response.
 */
export async function requestReload(
  host: MiscHost,
  cdate: string | Date,
): Promise<ReloadRequestResult | null> {
  return host.client.connectapi<ReloadRequestResult>(
    `/wellness-service/wellness/epoch/request/${pathSegment(formatDate(cdate))}`,
    { method: "POST" },
  );
}

/**
 * Pure passthrough to Garmin's GraphQL gateway; `query` (a raw
 * `{"query": "...", "variables": {...}}` body) is sent to Garmin verbatim.
 *
 * **The composed URL is the highest-risk part of this method.** The gateway path is easy to
 * write as `"graphql-gateway/graphql"`, with no leading slash. This client's `connectapi` does NOT
 * do relative joining: `GarminClient#apiRequest` composes the request URL by plain string concatenation
 * (`` `https://connectapi.${domain}${path}` ``), so a path with no leading slash would silently
 * glue onto the hostname instead of starting a new path segment (`connectapi.garmin.comgraphql-
 * gateway/graphql` — no such host, and NOT a 404 that would flag the mistake as "wrong URL").
 * The leading slash below is therefore load-bearing and deliberate, not a stylistic choice — see
 * `tests/services/misc.test.ts` for the literal composed-URL assertion that pins this.
 *
 * Returns Garmin's raw response.
 */
export async function queryGarminGraphql(
  host: MiscHost,
  query: Record<string, unknown>,
): Promise<GraphqlResult | null> {
  return host.client.connectapi<GraphqlResult>("/graphql-gateway/graphql", {
    method: "POST",
    json: query,
  });
}

/**
 * Makes **no HTTP call** — Garmin's token is never revoked server-side, only cleared locally.
 *
 * All it does is clear the configured `TokenStore` — `host.client.tokenStore.clear()`. There is no
 * in-memory profile cache to clear (each `Garmin` instance's `getUserProfile()` cache is simply
 * abandoned along with the instance itself — a fresh `Garmin` re-fetches), and where tokens live
 * on disk is `TokenStore`'s job, not this method's.
 *
 * **Does NOT clear the in-memory tokens already held by this `GarminClient` instance** — there is
 * no public API to do that (only `setTokens`/`getTokens`, no `clearTokens`), and `MiscHost` is
 * deliberately scoped to `{ client }` only. A process that calls `logout()`
 * and keeps using the same `GarminClient`/`Garmin` instance afterward will keep succeeding against
 * Garmin until the in-memory OAuth2 token expires (~27h) or a refresh is attempted after the
 * OAuth1 token also goes stale — at which point `tokenStore.load()` finds nothing and any refresh
 * fails. The safe pattern is to discard the `GarminClient` instance after calling `logout()`, not
 * to keep issuing requests through it.
 */
export async function logout(host: MiscHost): Promise<void> {
  await host.client.tokenStore.clear();
}
