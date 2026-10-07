/**
 * The hosted OAuth 2.1 authorization server, as the MCP SDK's `OAuthServerProvider`. Nothing the
 * client receives is stored: client ids, sign-in form state, codes and tokens are sealed. The
 * grant table only makes codes single-use, rotates refresh tokens, and allows revocation.
 */
import type { Response } from "express";
import { InvalidGrantError, InvalidTokenError, ServerError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { GarminError, GarminRateLimitError, type MfaState, type Tokens } from "garminconnect-js";
import { isDeadSession, type GarminAuth } from "./garmin-auth.js";
import { checkGeneration, type GrantStore } from "./grants.js";
import { credentialsPage, errorPage, isTrustedRedirect, mfaPage, pageHeaders, redirectTarget } from "./pages.js";
import type { Sealer } from "./seal.js";

/** Milliseconds spent in Garmin calls, summed across the calls of one sign-in POST. */
interface Timer {
  ms: number;
}

async function timed<T>(timer: Timer, call: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await call();
  } finally {
    timer.ms += Math.round(performance.now() - start);
  }
}

export const ACCESS_TTL_S = 3600;
export const CODE_TTL_S = 60;
export const FORM_TTL_S = 600;
export const REFRESH_WITHIN_MS = 2 * 3600_000;
export const TOUCH_EVERY_S = 60;

interface AuthRequest {
  clientId: string;
  clientName: string | null;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
}
interface MfaPayload {
  request: AuthRequest;
  mfaState: MfaState;
  disconnectOthers: boolean;
}
interface CodePayload {
  grantId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  tokens: Tokens;
}
interface AccessPayload {
  grantId: string;
  clientId: string;
  tokens: Tokens;
}
interface RefreshPayload extends AccessPayload {
  generation: number;
}
export interface AccessExtra {
  grantId: string;
  tokens: Tokens;
}

export interface ProviderOptions {
  sealer: Sealer;
  grants: GrantStore;
  auth: GarminAuth;
  /** Where the sign-in form posts. */
  signInPath: string;
  now?: () => number;
  /** Operational log lines; never given emails, passwords or tokens. */
  log?: (line: Record<string, unknown>) => void;
}

export type SignInOutcome =
  | { kind: "redirect"; location: string }
  | { kind: "page"; status: number; headers: Record<string, string>; body: string };

const EXPIRED = "This sign-in page has expired. Start again from your MCP client (remove and re-add the connector if needed).";

/** Garmin's SSO error codes, in plain words. */
const SSO_ERRORS: [code: string, message: string][] = [
  ["INVALID_CREDENTIALS", "Garmin didn't accept that email/username and password."],
  ["ACCOUNT_RESTRICTED", "Garmin has restricted this account. Sign in at connect.garmin.com to see why."],
  ["INVALID_MFA_CODE", "That verification code wasn't accepted. Try again."],
];

function signInError(error: unknown): string {
  if (error instanceof GarminRateLimitError) return "Garmin is limiting sign-ins right now. Wait a few minutes and try again.";
  if (error instanceof GarminError) {
    return SSO_ERRORS.find(([code]) => error.message.includes(code))?.[1] ?? `Sign-in failed: ${error.message}`;
  }
  return "Something went wrong signing you in. Try again in a minute.";
}

export class HostedOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;
  readonly #sealer: Sealer;
  readonly #grants: GrantStore;
  readonly #auth: GarminAuth;
  readonly #signInPath: string;
  readonly #now: () => number;
  readonly #log: (line: Record<string, unknown>) => void;

  constructor(options: ProviderOptions) {
    this.#sealer = options.sealer;
    this.#grants = options.grants;
    this.#auth = options.auth;
    this.#signInPath = options.signInPath;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.#log = options.log ?? (() => {});
    this.clientsStore = {
      getClient: (clientId) => {
        const sealed = this.#sealer.unseal<Omit<OAuthClientInformationFull, "client_id">>("client", clientId);
        return sealed ? { ...sealed.data, client_id: clientId } : undefined;
      },
      // The whole registration (including a confidential client's secret) is sealed into the id.
      registerClient: (client) => {
        const info = { ...client, client_id_issued_at: this.#now() };
        return { ...info, client_id: this.#sealer.seal("client", info) };
      },
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const request: AuthRequest = {
      clientId: client.client_id,
      clientName: client.client_name ?? null,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      ...(params.state !== undefined && { state: params.state }),
    };
    res
      .status(200)
      .set(pageHeaders(params.redirectUri))
      .send(
        credentialsPage({ action: this.#signInPath, request: this.#sealer.seal("authreq", request, FORM_TTL_S), clientName: request.clientName, redirectUri: request.redirectUri }),
      );
  }

  /** The sign-in form's POST: credentials, then (if Garmin asks) the MFA code. */
  async handleSignIn(form: Record<string, string | undefined>): Promise<SignInOutcome> {
    const action = this.#signInPath;
    if (form["step"] === "mfa") {
      const sealedMfa = form["mfa"];
      const mfa = this.#sealer.unseal<MfaPayload>("mfa", sealedMfa);
      if (!mfa) return this.#page(undefined, errorPage(EXPIRED), 400);
      const { request, mfaState, disconnectOthers } = mfa.data;
      const timer = { ms: 0 };
      try {
        const tokens = await timed(timer, () => this.#auth.resume(mfaState, (form["code"] ?? "").trim()));
        const outcome = await this.#finish(request, tokens, disconnectOthers, timer);
        this.#log({ msg: "sign-in", ms: timer.ms, mfa: true, ok: true });
        return outcome;
      } catch (error) {
        const message = this.#signInError(error);
        this.#log({ msg: "sign-in", ms: timer.ms, mfa: true, ok: false });
        return this.#page(request, mfaPage({ action, mfa: sealedMfa!, error: message }), 400);
      }
    }

    const sealedRequest = form["request"];
    const unsealed = this.#sealer.unseal<AuthRequest>("authreq", sealedRequest);
    if (!unsealed) return this.#page(undefined, errorPage(EXPIRED), 400);
    const request = unsealed.data;
    const email = (form["email"] ?? "").trim();
    const password = form["password"] ?? "";
    const disconnectOthers = form["disconnectOthers"] === "1";
    const retry = (error: string) =>
      this.#page(request, credentialsPage({ action, request: sealedRequest!, clientName: request.clientName, redirectUri: request.redirectUri, email, error }), 400);
    if (!email || !password) return retry("Enter your Garmin email (or username) and password.");
    // Enforced here, before Garmin is called; the MFA step only exists past this point.
    if (!isTrustedRedirect(request.redirectUri) && form["confirmRedirect"] !== "1") {
      return retry(`Tick the box to confirm you trust ${redirectTarget(request.redirectUri)} before signing in.`);
    }
    const timer = { ms: 0 };
    try {
      const result = await timed(timer, () => this.#auth.login(email, password));
      if (result.state === "mfa_required") {
        const mfa = this.#sealer.seal("mfa", { request, mfaState: result.mfaState, disconnectOthers } satisfies MfaPayload, FORM_TTL_S);
        const page = this.#page(request, mfaPage({ action, mfa }));
        this.#log({ msg: "sign-in", ms: timer.ms, mfa: false, ok: true });
        return page;
      }
      const outcome = await this.#finish(request, result.tokens, disconnectOthers, timer);
      this.#log({ msg: "sign-in", ms: timer.ms, mfa: false, ok: true });
      return outcome;
    } catch (error) {
      const message = this.#signInError(error);
      this.#log({ msg: "sign-in", ms: timer.ms, mfa: false, ok: false });
      return retry(message);
    }
  }

  #signInError(error: unknown): string {
    if (error instanceof GarminRateLimitError) this.#log({ msg: "garmin rate limited" });
    return signInError(error);
  }

  async #finish(request: AuthRequest, tokens: Tokens, disconnectOthers: boolean, timer: Timer): Promise<SignInOutcome> {
    const userHash = this.#sealer.pseudonym(await timed(timer, () => this.#auth.profileId(tokens)));
    const grant = this.#grants.create(userHash, request.clientName, this.#now());
    if (disconnectOthers) this.#grants.revokeUser(userHash, grant.grantId);
    const code: CodePayload = { grantId: grant.grantId, clientId: request.clientId, redirectUri: request.redirectUri, codeChallenge: request.codeChallenge, tokens };
    const location = new URL(request.redirectUri);
    location.searchParams.set("code", this.#sealer.seal("code", code, CODE_TTL_S));
    if (request.state !== undefined) location.searchParams.set("state", request.state);
    return { kind: "redirect", location: location.href };
  }

  #page(request: AuthRequest | undefined, body: string, status = 200): SignInOutcome {
    return { kind: "page", status, headers: pageHeaders(request?.redirectUri), body };
  }

  #code(client: OAuthClientInformationFull, code: string): CodePayload {
    const sealed = this.#sealer.unseal<CodePayload>("code", code);
    if (!sealed || sealed.data.clientId !== client.client_id) throw new InvalidGrantError("The authorization code is invalid or has expired");
    return sealed.data;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    return this.#code(client, code).codeChallenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string): Promise<OAuthTokens> {
    const payload = this.#code(client, code);
    if (redirectUri !== undefined && redirectUri !== payload.redirectUri) throw new InvalidGrantError("redirect_uri does not match the authorization request");
    if (!this.#grants.activate(payload.grantId, this.#now())) {
      // A replayed code: revoke what the first exchange issued (RFC 6749 §4.1.2).
      if (this.#grants.get(payload.grantId)?.state === "active") this.#grants.revoke(payload.grantId);
      throw new InvalidGrantError("The authorization code has already been used");
    }
    return this.#issue(payload.grantId, client.client_id, 0, payload.tokens);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    const sealed = this.#sealer.unseal<RefreshPayload>("refresh", refreshToken);
    if (!sealed || sealed.data.clientId !== client.client_id) throw new InvalidGrantError("The refresh token is invalid");
    const { grantId, generation } = sealed.data;
    const verdict = checkGeneration(this.#grants.get(grantId), generation, this.#now());
    if (verdict === "missing" || verdict === "revoked") throw new InvalidGrantError("This connection was disconnected; sign in again");
    if (verdict === "reused") {
      this.#grants.revoke(grantId);
      throw new InvalidGrantError("This refresh token was already used, so the connection was disconnected for safety; sign in again");
    }
    let tokens: Tokens;
    try {
      tokens = await this.#auth.refresh(sealed.data.tokens, REFRESH_WITHIN_MS);
    } catch (error) {
      if (isDeadSession(error)) {
        this.#grants.revoke(grantId);
        throw new InvalidGrantError("Your Garmin session has ended; sign in again");
      }
      throw new ServerError("Garmin could not refresh the session right now; try again shortly");
    }
    const rotated = this.#grants.rotate(grantId, generation, this.#now());
    if (!rotated.ok) throw new InvalidGrantError("This connection was disconnected; sign in again");
    return this.#issue(grantId, client.client_id, rotated.generation, tokens);
  }

  #issue(grantId: string, clientId: string, generation: number, tokens: Tokens): OAuthTokens {
    return {
      access_token: this.#sealer.seal("access", { grantId, clientId, tokens } satisfies AccessPayload, ACCESS_TTL_S),
      token_type: "bearer",
      expires_in: ACCESS_TTL_S,
      refresh_token: this.#sealer.seal("refresh", { grantId, clientId, generation, tokens } satisfies RefreshPayload),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const sealed = this.#sealer.unseal<AccessPayload>("access", token);
    if (!sealed || sealed.exp === undefined) throw new InvalidTokenError("The access token is invalid or has expired");
    const grant = this.#grants.get(sealed.data.grantId);
    if (grant?.state !== "active") throw new InvalidTokenError("This connection was disconnected");
    const now = this.#now();
    if (now - grant.lastUsed >= TOUCH_EVERY_S) this.#grants.touch(grant.grantId, now);
    const extra: AccessExtra = { grantId: grant.grantId, tokens: sealed.data.tokens };
    return { token, clientId: sealed.data.clientId, scopes: [], expiresAt: sealed.exp, extra: { ...extra } };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const found =
      this.#sealer.unseal<AccessPayload>("access", request.token) ?? this.#sealer.unseal<RefreshPayload>("refresh", request.token);
    if (found && found.data.clientId === client.client_id) this.#grants.revoke(found.data.grantId);
  }
}
