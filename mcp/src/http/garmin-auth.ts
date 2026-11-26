/** Every Garmin call the OAuth server makes, behind one interface so tests can fake Garmin's SSO. */
import { Garmin, GarminAuthError, GarminDiveAuthError, GarminClient, type GarminClientOptions, type MfaState, type Tokens } from "garminconnect-js";

export type SignInResult = { state: "success"; tokens: Tokens } | { state: "mfa_required"; mfaState: MfaState };

export interface GarminAuth {
  login(email: string, password: string): Promise<SignInResult>;
  resume(mfaState: MfaState, code: string): Promise<Tokens>;
  profileId(tokens: Tokens): Promise<string>;
  /** Renews Connect credentials; Dive preparation is best-effort. */
  refresh(tokens: Tokens, withinMs: number): Promise<Tokens>;
}

export function garminAuth(options: Omit<GarminClientOptions, "tokenStore"> = {}): GarminAuth {
  const withTokens = (tokens: Tokens) => {
    const client = new GarminClient(options);
    client.setTokens(tokens);
    return client;
  };
  return {
    async login(email, password) {
      const client = new GarminClient(options);
      const result = await client.login(email, password);
      return result.state === "mfa_required" ? { state: "mfa_required", mfaState: result.mfaState } :
        { state: "success", tokens: await prepareTokens(client) };
    },
    async resume(mfaState, code) {
      const client = new GarminClient(options);
      await client.resumeLogin(mfaState, code);
      return prepareTokens(client);
    },
    async profileId(tokens) {
      return String((await new Garmin(withTokens(tokens)).getUserProfile()).profileId);
    },
    refresh: (tokens, withinMs) => prepareTokens(withTokens(tokens), withinMs),
  };
}

async function prepareTokens(client: GarminClient, withinMs = 0): Promise<Tokens> {
  const tokens = await client.refreshTokens({ withinMs });
  try {
    return await client.refreshTokens({ withinMs, includeDive: true });
  } catch {
    console.warn("garminconnect-mcp: Dive token preparation failed; Connect remains available. Dive writes will retry authentication.");
    return tokens;
  }
}

/**
 * Garmin has really ended the session (the library's own rule for clearing saved tokens): a 401,
 * or its "log in again" refresh errors. A 403 is usually Cloudflare and passes; never revoke on it.
 */
export function isDeadSession(error: unknown): boolean {
  return error instanceof GarminAuthError && !(error instanceof GarminDiveAuthError) &&
    (error.message.endsWith("(401)") || /log in again/i.test(error.message));
}
