/**
 * The hosted server's `Session`: tools are built once, and each HTTP request runs inside its own
 * AsyncLocalStorage context carrying that user's Garmin tokens (unsealed from the access token).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { Garmin, GarminClient, type GarminClientOptions, type Tokens } from "garminconnect-js";
import type { Session } from "../session.js";

export interface RequestContext {
  grantId: string;
  tokens: Tokens;
  onRejected(error: unknown): void;
}

export const RECONNECT_HINT =
  "reconnect the Garmin connector in your MCP client (in claude.ai: Settings → Connectors), then try again";

export interface RequestSession extends Session {
  run<T>(context: RequestContext, fn: () => Promise<T>): Promise<T>;
}

export function requestSession(clientOptions: Omit<GarminClientOptions, "tokenStore"> = {}): RequestSession {
  const storage = new AsyncLocalStorage<{ context: RequestContext; garmin?: Garmin }>();
  return {
    loginHint: RECONNECT_HINT,
    run: (context, fn) => storage.run({ context }, fn),
    async get() {
      const store = storage.getStore();
      if (!store) throw new Error("No Garmin connection for this request");
      if (!store.garmin) {
        const client = new GarminClient(clientOptions);
        client.setTokens(store.context.tokens);
        store.garmin = new Garmin(client);
      }
      return store.garmin;
    },
    reset(options) {
      if (options?.rejected) storage.getStore()?.context.onRejected(options.error);
    },
  };
}
