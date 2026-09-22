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

export function isExpired(
  token: OAuth2Token,
  marginSeconds = 60,
  nowMs: number = Date.now(),
): boolean {
  return token.expires_at - marginSeconds <= Math.floor(nowMs / 1000);
}

export function refreshExpired(
  token: OAuth2Token,
  nowMs: number = Date.now(),
): boolean {
  return token.refresh_token_expires_at <= Math.floor(nowMs / 1000);
}

export function authorizationHeader(token: OAuth2Token): string {
  const type = token.token_type;
  const titled = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  return `${titled} ${token.access_token}`;
}
