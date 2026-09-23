/**
 * `GET /lifestylelogging-service/dailyLog/{cdate}` (`get_lifestyle_logging_data`). Passes through
 * unchecked; undocumented shape — grouped under `misc` per the task's explicit instruction even
 * though it superficially resembles a wellness-daily endpoint.
 */
export interface LifestyleLoggingData {
  [key: string]: unknown;
}

/**
 * `POST /wellness-service/wellness/epoch/request/{cdate}` (`request_reload`). UNCERTAIN upstream
 * null handling — upstream's `client.post` is called with no explicit null-guard on the response.
 * Undocumented shape.
 */
export interface ReloadRequestResult {
  [key: string]: unknown;
}

/**
 * Response body of `POST graphql-gateway/graphql` (`query_garmin_graphql`). Upstream calls
 * `.json()` directly on the response with no null-check — UNCERTAIN null handling. Shape is
 * entirely caller/query-dependent (a standard GraphQL `{ data, errors? }` envelope in practice),
 * so this is intentionally unstructured.
 */
export interface GraphqlResult {
  [key: string]: unknown;
}
