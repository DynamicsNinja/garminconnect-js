import { pathSegment } from "../util/validate.js";
import type { GarminClient } from "../client.js";
import { formatDate } from "../util/date.js";
import type { GraphqlResult, LifestyleLoggingData, ReloadRequestResult } from "../types/misc.js";

/**
 * The `misc` inventory section: lifestyle-logging data, the "request a reload" write, the raw
 * GraphQL gateway passthrough, and `logout`. `logout` is the only member with no HTTP call.
 */
export interface MiscHost {
  readonly client: GarminClient;
}

/**
 * Upstream `get_lifestyle_logging_data`. `null_behaviour`: passes through unchecked.
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
 * Upstream `request_reload`. A WRITE: asks Garmin to reload/recompute a day's data (Garmin
 * offloads older data, so this is how a caller forces it back). Sent with no JSON body, matching
 * upstream's `client.post(url)` call with no `json=` kwarg.
 *
 * UNCERTAIN upstream null handling (inventory row is explicitly marked UNCERTAIN — `client.post`
 * has no explicit null-guard on the response in `gc.py`): implemented as a straightforward
 * pass-through, matching this project's standing rule for UNCERTAIN rows. Resolving this for real
 * would mean reading Garmin's actual response body for a reload request, which was out of scope
 * here per the task's SAFETY section (do not execute this against the live account without the
 * controller's explicit go-ahead).
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
 * Upstream `query_garmin_graphql`. Pure passthrough to Garmin's GraphQL gateway; `query` is sent
 * to Garmin verbatim, matching upstream's raw `{"query": "...", "variables": {...}}` body.
 *
 * **The composed URL is the highest-risk part of this method.** Upstream's own endpoint constant
 * is `"graphql-gateway/graphql"` — no leading slash, unlike every other constant in `gc.py`.
 * Upstream's HTTP layer (`requests` + a base URL) tolerates that because of how `urljoin`-style
 * joining treats a relative path. This TS client's `connectapi` does NOT do relative joining: `
 * GarminClient#apiRequest` composes the request URL by plain string concatenation
 * (`` `https://connectapi.${domain}${path}` ``), so a path with no leading slash would silently
 * glue onto the hostname instead of starting a new path segment (`connectapi.garmin.comgraphql-
 * gateway/graphql` — no such host, and NOT a 404 that would flag the mistake as "wrong URL").
 * The leading slash below is therefore load-bearing and deliberate, not a stylistic choice — see
 * `tests/services/misc.test.ts` for the literal composed-URL assertion that pins this.
 *
 * UNCERTAIN upstream null handling (inventory row is explicitly marked UNCERTAIN — upstream calls
 * `.json()` on the response directly, with no null-guard): implemented as a straightforward
 * pass-through per this project's standing rule for UNCERTAIN rows.
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
 * Upstream `logout`. Makes **no HTTP call** — Garmin's token is never revoked server-side, only
 * cleared locally, matching upstream exactly ("Does not revoke the token server-side — local-only").
 *
 * Upstream additionally clears in-memory auth fields (`username`, `full_name`, `unit_system`, …)
 * and optionally unlinks an on-disk token file resolved from an argument or the `GARMINTOKENS`
 * env var. Neither of those maps cleanly onto this port: there is no equivalent in-memory cache to
 * clear here (each `Garmin` instance's `getUserProfile()` cache is simply abandoned along with the
 * instance itself — a fresh `Garmin` re-fetches), and file-vs-inline-token resolution is already
 * `TokenStore`'s job, not this method's. So this method reduces to upstream's actual load-bearing
 * side effect for a server: clearing the configured `TokenStore` — `host.client.tokenStore.clear()`.
 *
 * **Does NOT clear the in-memory tokens already held by this `GarminClient` instance** — there is
 * no public API to do that (only `setTokens`/`getTokens`, no `clearTokens`), and `MiscHost` is
 * deliberately scoped to `{ client }` only, per this task's brief. A process that calls `logout()`
 * and keeps using the same `GarminClient`/`Garmin` instance afterward will keep succeeding against
 * Garmin until the in-memory OAuth2 token expires (~27h) or a refresh is attempted after the
 * OAuth1 token also goes stale — at which point `tokenStore.load()` finds nothing and any refresh
 * fails. The safe pattern is to discard the `GarminClient` instance after calling `logout()`, not
 * to keep issuing requests through it.
 */
export async function logout(host: MiscHost): Promise<void> {
  await host.client.tokenStore.clear();
}
