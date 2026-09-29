/**
 * `sign_in_to_garmin`: signs the user in without a terminal, via the localhost page in
 * signin-page.ts. Always registered; the hint in every "not logged in" error points here.
 */
import { spawn } from "node:child_process";
import { FileTokenStore, Garmin, GarminAuthError, GarminClient } from "garminconnect-js";
import { textResult } from "./results.js";
import type { ToolFactory } from "./server.js";
import { startSignInPage, type SignInClient, type SignInPage } from "./signin-page.js";

/** Only ever a `startSignInPage` URL: 127.0.0.1, a numeric port, and a URL-safe key. */
const SAFE_SIGNIN_URL = /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+$/;

/** Opens a URL in the default browser. Output is discarded (stdout carries MCP frames). */
export function openInBrowser(url: string): void {
  // `cmd /c start` parses `&`/`^` etc. as shell metacharacters; refuse anything that isn't the
  // exact shape this module itself generates rather than risk that on a would-be malicious URL.
  if (!SAFE_SIGNIN_URL.test(url)) return;
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The URL is in the tool result; the user can open it by hand.
  }
}

function tokenStoreClient(tokenDir: string): SignInClient {
  const client = new GarminClient({ tokenStore: new FileTokenStore(tokenDir) });
  return {
    login: (email, password) => client.login(email, password),
    resumeLogin: (state, code) => client.resumeLogin(state, code),
    displayName: async () => (await new Garmin(client).getUserProfile()).displayName,
  };
}

export interface SignInToolOptions {
  openUrl?: (url: string) => void;
  createClient?: (tokenDir: string) => SignInClient;
  idleMs?: number;
}

export function signInTools(options: SignInToolOptions = {}): ToolFactory {
  const openUrl = options.openUrl ?? openInBrowser;
  const createClient = options.createClient ?? tokenStoreClient;
  let page: SignInPage | null = null;
  // Two overlapping calls both seeing `page === null` would otherwise start two servers; cache
  // the in-flight start so concurrent calls share one page.
  let starting: Promise<SignInPage> | null = null;

  return ({ config, session }) => [
    {
      tool: {
        name: "sign_in_to_garmin",
        description:
          "Sign in to Garmin Connect. Call this when another Garmin tool says you are not logged in or the session " +
          "expired. It opens a sign-in page in the user's browser; the password and MFA code are entered there, never " +
          "in the chat. Afterwards, ask the user to tell you when they have finished, then retry.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { title: "Sign in to Garmin", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      async run() {
        try {
          // `getUserProfile` is cached per `Garmin` (one fetch, reused after), so this check is
          // cheap on repeat calls; `server.ts` resets the session on any `GarminAuthError` from a
          // tool, so a truly expired session is never cached across calls either.
          const profile = await (await session.get()).getUserProfile();
          return textResult(`Already signed in to Garmin as ${profile.displayName}.`);
        } catch (error) {
          if (!(error instanceof GarminAuthError)) throw error;
        }
        if (!page) {
          starting ??= startSignInPage({
            createClient: () => createClient(config.tokenDir),
            onSignedIn: () => session.reset(),
            idleMs: options.idleMs,
          });
          const started = await starting;
          starting = null;
          page = started;
          void started.closed.then(() => {
            if (page === started) page = null;
          });
        }
        openUrl(page.url);
        return textResult(
          `A Garmin sign-in page opened in your browser: ${page.url}\n` +
            "Sign in there (including any MFA code), then tell me when you're done.",
        );
      },
    },
  ];
}
