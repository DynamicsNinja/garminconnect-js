/**
 * `GET /lifestylelogging-service/dailyLog/{cdate}`. Passes through
 * unchecked; undocumented shape — grouped under `misc` even though it superficially resembles a
 * wellness-daily endpoint.
 */
export interface LifestyleLoggingData {
  [key: string]: unknown;
}

/**
 * `POST /wellness-service/wellness/epoch/request/{cdate}`. The response is
 * passed through with no null-guard. Undocumented shape.
 */
export interface ReloadRequestResult {
  [key: string]: unknown;
}

/**
 * Response body of `POST /graphql-gateway/graphql`. Passed through with no
 * null-check. Shape is
 * entirely caller/query-dependent (a standard GraphQL `{ data, errors? }` envelope in practice),
 * so this is intentionally unstructured.
 */
export interface GraphqlResult {
  [key: string]: unknown;
}
