export interface OAuth1Token {
  oauth_token: string;
  oauth_token_secret: string;
  mfa_token?: string;
  mfa_expiration_timestamp?: string;
  domain?: string;
}

export interface RawOAuth2Token {
  scope: string;
  jti: string;
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_token_expires_in: number;
}

export interface OAuth2Token extends RawOAuth2Token {
  /** epoch seconds */
  expires_at: number;
  /** epoch seconds */
  refresh_token_expires_at: number;
}

export interface Tokens {
  oauth1: OAuth1Token;
  oauth2: OAuth2Token;
}

export function setExpirations(raw: RawOAuth2Token, nowMs: number = Date.now()): OAuth2Token {
  const now = Math.floor(nowMs / 1000);
  return {
    ...raw,
    expires_at: now + raw.expires_in,
    refresh_token_expires_at: now + raw.refresh_token_expires_in,
  };
}

/**
 * Fails CLOSED on a malformed token. `expires_at` is typed as a `number`, but a token that came
 * back from a caller-implemented `TokenStore` (the normal production choice — see AGENTS.md §5)
 * can lose the field to a database schema or a field allowlist. The naive arithmetic
 * (`undefined - 60 <= now` -> `NaN <= number` -> `false`) reports "not expired", so the client
 * never refreshes and the user is silently logged out roughly every 27 hours with nothing pointing
 * at the cause. Treating an unknown expiry as expired is self-healing instead: it triggers a
 * refresh, which succeeds as long as the OAuth1 token is still live.
 */
export function isExpired(
  token: OAuth2Token,
  marginSeconds = 60,
  nowMs: number = Date.now(),
): boolean {
  if (!Number.isFinite(token.expires_at)) return true;
  return token.expires_at - marginSeconds <= Math.floor(nowMs / 1000);
}

/** Fails closed on a malformed token, same reasoning as `isExpired`. */
export function refreshExpired(
  token: OAuth2Token,
  nowMs: number = Date.now(),
): boolean {
  if (!Number.isFinite(token.refresh_token_expires_at)) return true;
  return token.refresh_token_expires_at <= Math.floor(nowMs / 1000);
}

export function authorizationHeader(token: OAuth2Token): string {
  const type = token.token_type;
  const titled = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  return `${titled} ${token.access_token}`;
}
