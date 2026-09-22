export const CLIENT_ID = "GCM_ANDROID_DARK";
export const OAUTH_CONSUMER_URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json";

/** Must match the Android consumer key fetched from S3. */
export const OAUTH_USER_AGENT = "com.garmin.android.apps.connectmobile";
export const API_USER_AGENT = "GCM-iOS-5.22.1.4";

const SSO_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

/**
 * The SSO endpoints run in a WebView. Without browser-shaped headers,
 * Cloudflare challenges the request and login fails.
 */
export const SSO_PAGE_HEADERS: Record<string, string> = {
  "User-Agent": SSO_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Dest": "document",
};
