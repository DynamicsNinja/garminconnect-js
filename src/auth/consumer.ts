import type { Fetcher } from "../http/fetcher.js";
import { OAUTH_CONSUMER_URL } from "./constants.js";

export interface ConsumerCredentials {
  consumer_key: string;
  consumer_secret: string;
}

let cached: ConsumerCredentials | undefined;

/**
 * The consumer key/secret come from a bucket controlled by garth's author.
 * Cached process-wide because they never change between calls.
 */
export async function fetchConsumer(
  fetcher: Fetcher,
  url: string = OAUTH_CONSUMER_URL,
): Promise<ConsumerCredentials> {
  if (cached) return cached;
  const res = await fetcher.request(url);
  cached = (await res.json()) as ConsumerCredentials;
  return cached;
}

/** Test seam. */
export function resetConsumerCache(): void {
  cached = undefined;
}
