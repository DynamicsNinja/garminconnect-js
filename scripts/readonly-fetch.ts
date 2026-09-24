/**
 * A `fetch` wrapper that refuses to send anything but a GET.
 *
 * This is the load-bearing safety property of `scripts/smoke-readonly-real.ts`, which points at a
 * real person's Garmin account. "The probe list only contains read methods" is an intention, and
 * intentions do not survive edits; this survives edits, because a write cannot leave the process
 * regardless of what the list says.
 *
 * Exactly one exception: the OAuth2 token refresh is a POST to `/oauth-service/oauth/exchange/…`
 * by Garmin's design, and it happens automatically inside `GarminClient` before any call whose
 * access token has aged out (~27h). Blocking it would make the harness work only for 27 hours
 * after a login. It writes no user data — it trades an OAuth1 token for an access token.
 *
 * Lives in `scripts/` rather than `src/` deliberately: it is test-harness scaffolding, not part of
 * the published API surface. It is unit-tested in `tests/readonly-fetch.test.ts` anyway, because
 * an unverified safety mechanism is just a comment.
 */

/** The one non-GET request allowed through: Garmin's OAuth2 token refresh. */
const TOKEN_REFRESH_PATH = "/oauth-service/oauth/exchange/";

/**
 * `fetch`'s own first-parameter type. Spelled this way rather than `RequestInfo | URL` because
 * this package targets Node without the DOM lib, where `RequestInfo` is not in scope — and an
 * out-of-scope name silently becomes `any`, which would defeat every check below.
 */
type FetchInput = Parameters<typeof fetch>[0];

/** Resolves the method the way `fetch` itself would: `init.method`, else a Request's own, else GET. */
function resolveMethod(input: FetchInput, init?: RequestInit): string {
  if (init?.method !== undefined) return init.method.toUpperCase();
  if (typeof input === "object" && input !== null && "method" in input) {
    return String(input.method).toUpperCase();
  }
  return "GET";
}

/** Resolves the URL from any of `fetch`'s three input forms. */
function resolveUrl(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Wraps `inner` (real `fetch` by default) so that every non-GET request throws before it is sent.
 * The thrown message carries the method and the path with its query string stripped — a Garmin
 * service ticket rides in the query string, so it must not reach a log.
 */
export function createReadOnlyFetch(inner: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const method = resolveMethod(input, init);
    const url = resolveUrl(input);
    if (method !== "GET" && !url.includes(TOKEN_REFRESH_PATH)) {
      throw new Error(
        `read-only harness refused a ${method} request to ${url.split("?")[0] ?? ""} — it never ` +
          "writes to a real account. Remove the call, or move it to the test-account script.",
      );
    }
    return inner(input, init);
  };
}
