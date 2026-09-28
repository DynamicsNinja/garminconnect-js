import os from "node:os";
import path from "node:path";
import { FileTokenStore, Garmin, GarminAuthError, GarminClient, type GarminClientOptions } from "garminconnect-js";

export interface McpConfig {
  tokenDir: string;
  downloadDir: string;
  /** Manifest categories to expose; `null` means all. */
  groups: ReadonlySet<string> | null;
  enableGraphql: boolean;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): McpConfig {
  const home = os.homedir();
  const groups = (env["GARMIN_MCP_GROUPS"] ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  return {
    tokenDir: env["GARMIN_MCP_TOKEN_DIR"] || path.join(home, ".garminconnect-mcp", "tokens"),
    downloadDir: env["GARMIN_MCP_DOWNLOAD_DIR"] || path.join(home, "Downloads", "garmin"),
    groups: groups.length > 0 ? new Set(groups) : null,
    enableGraphql: env["GARMIN_MCP_ENABLE_GRAPHQL"] === "1",
  };
}

/** No saved login to load. */
export class NotLoggedInError extends GarminAuthError {}

/**
 * Where tools get their `Garmin` from. Today: one session from a token directory. A hosted
 * version would supply one per user; tool code only ever sees this interface.
 */
export interface Session {
  get(): Promise<Garmin>;
  /** Drop the cached client so the next `get()` reloads tokens from disk. */
  reset(): void;
}

export function fileSession(tokenDir: string, options: Omit<GarminClientOptions, "tokenStore"> = {}): Session {
  let current: Promise<Garmin> | null = null;
  return {
    get() {
      current ??= (async () => {
        const client = new GarminClient({ ...options, tokenStore: new FileTokenStore(tokenDir) });
        if (!(await client.loadTokens())) throw new NotLoggedInError(`No saved Garmin login in ${tokenDir}`);
        return new Garmin(client);
      })().catch((error: unknown) => {
        current = null; // a failure is never cached: a login made later is picked up on the next call
        throw error;
      });
      return current;
    },
    reset() {
      current = null;
    },
  };
}
