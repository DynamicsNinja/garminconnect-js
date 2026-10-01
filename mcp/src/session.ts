import os from "node:os";
import path from "node:path";
import {
  FileTokenStore,
  Garmin,
  GarminAuthError,
  GarminClient,
  type GarminClientOptions,
  type LoginResult,
} from "garminconnect-js";

/** A Garmin email and password from the extension settings (or env), for signing in unattended. */
export interface Credentials {
  email: string;
  password: string;
}

export interface McpConfig {
  tokenDir: string;
  downloadDir: string;
  /** Manifest categories to expose; `null` means all. */
  groups: ReadonlySet<string> | null;
  enableGraphql: boolean;
  /** Set only when BOTH email and password are configured. */
  credentials: Credentials | null;
}

/**
 * A setting's value, or undefined when it is empty or still carries an unsubstituted
 * `${...}` template. mcpb substitutes `${HOME}`-style OS placeholders before
 * `${user_config.*}` placeholders, so a value can come through with `${` left in it from
 * either kind — not only a value that is ENTIRELY a template, like `${user_config.groups}`.
 * `${HOME}/Downloads/garmin` (a literal, unexpanded `${HOME}`) must be treated as unset too.
 */
const setting = (value: string | undefined): string | undefined => {
  const v = value?.trim();
  return v && !v.includes("${") ? v : undefined;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): McpConfig {
  const home = os.homedir();
  const groups = (setting(env["GARMIN_MCP_GROUPS"]) ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  const graphql = (setting(env["GARMIN_MCP_ENABLE_GRAPHQL"]) ?? "").toLowerCase();
  // A relative path is also treated as unset: it's never what a "Downloads folder" picker means,
  // and it would otherwise resolve against whatever directory the server happens to start in.
  const downloadDir = setting(env["GARMIN_MCP_DOWNLOAD_DIR"]);
  const email = setting(env["GARMIN_EMAIL"]);
  // The password is used as typed: spaces can be part of it. Only the empty/template check applies.
  const password = env["GARMIN_PASSWORD"];
  const hasPassword = setting(password) !== undefined;
  return {
    tokenDir: setting(env["GARMIN_MCP_TOKEN_DIR"]) ?? path.join(home, ".garminconnect-mcp", "tokens"),
    downloadDir: downloadDir && path.isAbsolute(downloadDir) ? downloadDir : path.join(home, "Downloads", "garmin"),
    groups: groups.length > 0 ? new Set(groups) : null,
    enableGraphql: graphql === "1" || graphql === "true",
    credentials: email && hasPassword && password ? { email, password } : null,
  };
}

/** No usable login. `reason` says why, when there is more to say than "none saved". */
export class NotLoggedInError extends GarminAuthError {
  constructor(
    message: string,
    readonly reason?: string,
  ) {
    super(message);
  }
}

/**
 * Where tools get their `Garmin` from. Today: one session from a token directory. A hosted
 * version would supply one per user; tool code only ever sees this interface.
 */
export interface Session {
  get(): Promise<Garmin>;
  /**
   * Drop the cached client so the next `get()` reloads tokens from disk. `rejected` means Garmin
   * refused the session, so the saved tokens are no good and configured credentials should be used.
   */
  reset(options?: { rejected?: boolean }): void;
}

export interface FileSessionOptions {
  /** Signs in unattended when there are no usable saved tokens. */
  credentials?: Credentials | null;
  /** How to sign in; tests inject a fake. Defaults to `GarminClient#login`. */
  login?: (client: GarminClient, credentials: Credentials) => Promise<LoginResult>;
  client?: Omit<GarminClientOptions, "tokenStore">;
}

const defaultLogin = (client: GarminClient, { email, password }: Credentials) => client.login(email, password);

/**
 * Saved tokens always win. Configured credentials are used only when there are none, or Garmin
 * rejected them, and at most ONCE per process: a wrong password retried on every tool call would
 * get the account rate limited or locked. A failed attempt is reported on every later call until a
 * login made some other way (`sign_in_to_garmin`, the CLI) shows up on disk.
 */
export function fileSession(tokenDir: string, options: FileSessionOptions = {}): Session {
  const { credentials = null, login = defaultLogin } = options;
  let current: Promise<Garmin> | null = null;
  let rejected = false;
  let autoSignInFailure: string | null = null;
  let attempted = false;

  const open = async (): Promise<Garmin> => {
    const client = new GarminClient({ ...options.client, tokenStore: new FileTokenStore(tokenDir) });
    const hasTokens = await client.loadTokens();
    if ((!hasTokens || rejected) && credentials && !attempted) {
      attempted = true;
      try {
        const result = await login(client, credentials);
        if (result.state === "mfa_required") {
          throw new Error(
            "this Garmin account uses two-step verification, which can't be completed from the email and password in the settings",
          );
        }
        rejected = false;
        return new Garmin(client);
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        autoSignInFailure = `signing in with the configured Garmin email and password failed: ${why}`;
      }
    }
    if (!hasTokens) {
      throw new NotLoggedInError(`No saved Garmin login in ${tokenDir}`, autoSignInFailure ?? undefined);
    }
    return new Garmin(client);
  };

  return {
    get() {
      current ??= open().catch((error: unknown) => {
        current = null; // a failure is never cached: a login made later is picked up on the next call
        throw error;
      });
      return current;
    },
    reset(resetOptions) {
      current = null;
      rejected = resetOptions?.rejected === true;
    },
  };
}
