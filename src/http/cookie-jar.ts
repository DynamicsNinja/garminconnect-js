export interface SerializedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** epoch milliseconds; absent means a session cookie */
  expires?: number;
  secure: boolean;
  /** true when no Domain attribute was sent: match this host exactly */
  hostOnly: boolean;
}

function defaultPath(pathname: string): string {
  if (!pathname.startsWith("/") || pathname === "/") return "/";
  const i = pathname.lastIndexOf("/");
  return i === 0 ? "/" : pathname.slice(0, i);
}

function domainMatches(requestHost: string, cookieDomain: string, hostOnly: boolean): boolean {
  if (hostOnly) return requestHost === cookieDomain;
  return (
    requestHost === cookieDomain || requestHost.endsWith("." + cookieDomain)
  );
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

export class CookieJar {
  #cookies: SerializedCookie[] = [];

  setFromResponse(url: string, setCookieHeaders: string[]): void {
    const u = new URL(url);
    for (const header of setCookieHeaders) {
      const cookie = this.#parse(header, u);
      if (!cookie) continue;
      this.#cookies = this.#cookies.filter(
        (c) =>
          !(
            c.name === cookie.name &&
            c.domain === cookie.domain &&
            c.path === cookie.path
          ),
      );
      this.#cookies.push(cookie);
    }
  }

  #parse(header: string, u: URL): SerializedCookie | null {
    const [pair, ...attrs] = header.split(";");
    if (!pair) return null;
    const eq = pair.indexOf("=");
    if (eq < 1) return null;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();

    let domain = u.hostname;
    let hostOnly = true;
    let path = defaultPath(u.pathname);
    let expires: number | undefined;
    let secure = false;
    let maxAge: number | undefined;

    for (const attr of attrs) {
      const [rawKey, ...rest] = attr.split("=");
      const key = rawKey?.trim().toLowerCase();
      const val = rest.join("=").trim();
      if (key === "domain" && val) {
        domain = val.replace(/^\./, "").toLowerCase();
        hostOnly = false;
      } else if (key === "path" && val.startsWith("/")) {
        path = val;
      } else if (key === "expires" && val) {
        const t = Date.parse(val);
        if (!Number.isNaN(t)) expires = t;
      } else if (key === "max-age" && val) {
        const n = Number(val);
        if (!Number.isNaN(n)) maxAge = n;
      } else if (key === "secure") {
        secure = true;
      }
    }
    // Max-Age wins over Expires per RFC 6265 section 5.3.
    if (maxAge !== undefined) expires = Date.now() + maxAge * 1000;

    return { name, value, domain, path, expires, secure, hostOnly };
  }

  cookieHeaderFor(url: string): string | undefined {
    const u = new URL(url);
    const now = Date.now();
    this.#cookies = this.#cookies.filter((c) => c.expires === undefined || c.expires > now);

    const matches = this.#cookies.filter(
      (c) =>
        domainMatches(u.hostname, c.domain, c.hostOnly) &&
        pathMatches(u.pathname, c.path) &&
        (!c.secure || u.protocol === "https:"),
    );
    if (matches.length === 0) return undefined;
    return matches.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  toJSON(): SerializedCookie[] {
    return this.#cookies.map((c) => ({ ...c }));
  }

  /**
   * Upsert deserialized cookies into this jar, preserving every field
   * (`secure`, `expires`, `hostOnly`/`Domain`) exactly as stored — unlike
   * replaying them as synthetic `Set-Cookie` headers through
   * `setFromResponse`, which can only reconstruct what a real header would
   * carry and silently downgrades a `Domain`-scoped cookie to host-only.
   */
  mergeFromJSON(cookies: SerializedCookie[]): void {
    for (const cookie of cookies) {
      this.#cookies = this.#cookies.filter(
        (c) =>
          !(
            c.name === cookie.name &&
            c.domain === cookie.domain &&
            c.path === cookie.path
          ),
      );
      this.#cookies.push({ ...cookie });
    }
  }

  static fromJSON(cookies: SerializedCookie[]): CookieJar {
    const jar = new CookieJar();
    for (const c of cookies) jar.#cookies.push({ ...c });
    return jar;
  }
}
