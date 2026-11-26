import { GarminAuthError, GarminDiveAuthError } from "../errors.js";
import type { Fetcher } from "../http/fetcher.js";
import { isExpired, isValidDiveToken, setExpirations, type OAuth2Token, type RawOAuth2Token, type Tokens } from "./tokens.js";

const CLIENT_ID = "DIVE_MOBILE_ANDROID_DI";

/** Cross-app exchange observed in Garmin Dive Android; never replaces the Connect token. */
export async function exchangeDiveToken(fetcher: Fetcher, domain: string, tokens: Tokens): Promise<OAuth2Token> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    subject_token: tokens.oauth2.access_token,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
  });
  if (tokens.oauth1.mfa_token) body.set("mfa_token", tokens.oauth1.mfa_token);
  const res = await fetcher.request(`https://connectapi.${domain}/di-oauth2-service/oauth/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      "User-Agent": "com.garmin.android.apps.dive",
    },
    body: body.toString(),
  }).catch((cause: unknown) => {
    if (cause instanceof GarminAuthError) {
      throw new GarminDiveAuthError(cause.message, { cause });
    }
    throw cause;
  });
  let raw: RawOAuth2Token;
  try {
    raw = await res.json() as RawOAuth2Token;
  } catch {
    throw new GarminDiveAuthError("Dive token exchange returned a non-JSON response");
  }
  if (!raw || !Number.isFinite(raw.expires_in) || raw.expires_in <= 60) {
    throw new GarminDiveAuthError("Dive token exchange returned no usable DIVE_API_WRITE token");
  }
  const token = setExpirations(raw);
  if (!isValidDiveToken(token) || isExpired(token)) {
    throw new GarminDiveAuthError("Dive token exchange returned no usable DIVE_API_WRITE token");
  }
  return token;
}
