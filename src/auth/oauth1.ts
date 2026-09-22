import { createHmac, randomBytes } from "node:crypto";

/** RFC 3986 percent-encoding. `encodeURIComponent` leaves !*'() unescaped. */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** Scheme and host lowercased, default port dropped, query and fragment removed. */
function normalizeUrl(url: string): string {
  const u = new URL(url);
  const isDefaultPort =
    (u.protocol === "https:" && u.port === "443") ||
    (u.protocol === "http:" && u.port === "80");
  const port = u.port && !isDefaultPort ? `:${u.port}` : "";
  return `${u.protocol.toLowerCase()}//${u.hostname.toLowerCase()}${port}${u.pathname}`;
}

export function signatureBaseString(
  method: string,
  url: string,
  params: Record<string, string>,
): string {
  const encoded = Object.entries(params).map(
    ([k, v]) => [percentEncode(k), percentEncode(v)] as const,
  );
  encoded.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const normalized = encoded.map(([k, v]) => `${k}=${v}`).join("&");
  return [
    method.toUpperCase(),
    percentEncode(normalizeUrl(url)),
    percentEncode(normalized),
  ].join("&");
}

export interface OAuth1Args {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
  /** form-encoded body params, which must be included in the signature */
  bodyParams?: Record<string, string>;
  /** injectable for deterministic tests */
  nonce?: string;
  timestamp?: number;
}

export function buildOAuth1Header(args: OAuth1Args): string {
  const nonce = args.nonce ?? randomBytes(16).toString("hex");
  const timestamp = args.timestamp ?? Math.floor(Date.now() / 1000);

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: args.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp),
    oauth_version: "1.0",
  };
  if (args.token) oauthParams["oauth_token"] = args.token;

  const queryParams: Record<string, string> = {};
  for (const [k, v] of new URL(args.url).searchParams) queryParams[k] = v;

  const base = signatureBaseString(args.method, args.url, {
    ...queryParams,
    ...args.bodyParams,
    ...oauthParams,
  });

  const key = `${percentEncode(args.consumerSecret)}&${percentEncode(args.tokenSecret ?? "")}`;
  const signature = createHmac("sha1", key).update(base).digest("base64");

  const headerParams = { ...oauthParams, oauth_signature: signature };
  const parts = Object.entries(headerParams)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`);
  return `OAuth ${parts.join(", ")}`;
}
