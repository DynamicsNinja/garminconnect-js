import type { Fetcher } from "../http/fetcher.js";
import { GarminAuthError } from "../errors.js";
import { OAUTH_CONSUMER_URL } from "./constants.js";

export interface ConsumerCredentials {
  consumer_key: string;
  consumer_secret: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

let cached: ConsumerCredentials | undefined;

/**
 * The consumer key/secret come from a bucket controlled by garth's author.
 * Cached process-wide because they never change between calls.
 *
 * A malformed payload (missing/empty keys) is the hardest failure in this
 * library to diagnose otherwise: it would silently produce an unsignable
 * OAuth1 request that surfaces as a confusing 401 during login. Fail loudly
 * here instead, and never cache the bad response.
 */
export async function fetchConsumer(
  fetcher: Fetcher,
  url: string = OAUTH_CONSUMER_URL,
): Promise<ConsumerCredentials> {
  if (cached) return cached;
  const res = await fetcher.request(url);
  const body = (await res.json()) as Partial<ConsumerCredentials>;
  if (!isNonEmptyString(body.consumer_key) || !isNonEmptyString(body.consumer_secret)) {
    throw new GarminAuthError(
      `Consumer credentials response from ${url} is missing consumer_key/consumer_secret`,
    );
  }
  cached = { consumer_key: body.consumer_key, consumer_secret: body.consumer_secret };
  return cached;
}

/** Test seam. */
export function resetConsumerCache(): void {
  cached = undefined;
}
