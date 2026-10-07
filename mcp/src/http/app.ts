/**
 * The hosted server's HTTP surface. Traefik sends it `/mcp…` and the two OAuth `/.well-known`
 * documents. The OAuth endpoints are the SDK's own handlers, mounted under /mcp/oauth (the SDK's
 * all-in-one router would put them at the domain root, which belongs to another app).
 */
import express, { type Express, type Request, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { authorizationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/authorize.js";
import { clientRegistrationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/register.js";
import { revocationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/revoke.js";
import { tokenHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/token.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { mcpAuthMetadataRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { GarminClientOptions } from "garminconnect-js";
import { buildTools, serverForTools, type ServerDeps } from "../server.js";
import type { McpConfig } from "../session.js";
import { HOSTED_TOOL_FACTORIES } from "../tools.js";
import { isDeadSession, type GarminAuth } from "./garmin-auth.js";
import type { GrantStore } from "./grants.js";
import { inlineFiles } from "./inline-files.js";
import { errorPage, pageHeaders } from "./pages.js";
import { HostedOAuthProvider, type AccessExtra } from "./provider.js";
import { requestSession } from "./request-session.js";
import type { Sealer } from "./seal.js";

export interface HttpAppDeps {
  publicUrl: URL;
  sealer: Sealer;
  grants: GrantStore;
  auth: GarminAuth;
  mcp: McpConfig;
  version: string;
  trustProxy?: boolean;
  garminClient?: Omit<GarminClientOptions, "tokenStore">;
  log?: (line: Record<string, unknown>) => void;
  now?: () => number;
}

const DOCS = "https://github.com/DynamicsNinja/garminconnect-js/tree/main/mcp#readme";
const SIGN_IN_PATH = "/mcp/oauth/signin";

const accessOf = (req: Request): AccessExtra => {
  const extra = req.auth?.extra as AccessExtra | undefined;
  if (!extra) throw new Error("request reached /mcp without authentication");
  return extra;
};

/** Only the JSON-RPC method and tool name are logged: never arguments, results or tokens. */
function describeRpc(body: unknown): { rpc?: string; tool?: string } {
  const msg: unknown = Array.isArray(body) ? (body as unknown[])[0] : body;
  if (typeof msg !== "object" || msg === null) return {};
  const { method, params } = msg as { method?: unknown; params?: { name?: unknown } };
  return {
    ...(typeof method === "string" && { rpc: method }),
    ...(method === "tools/call" && typeof params?.name === "string" && { tool: params.name }),
  };
}

export function createHttpApp(deps: HttpAppDeps): Express {
  const base = new URL(deps.publicUrl.origin);
  const at = (p: string) => new URL(p, base).href;
  const log = deps.log ?? ((line) => console.log(JSON.stringify({ t: new Date().toISOString(), ...line })));
  const provider = new HostedOAuthProvider({ sealer: deps.sealer, grants: deps.grants, auth: deps.auth, signInPath: SIGN_IN_PATH, now: deps.now });
  const metadata: OAuthMetadata = {
    issuer: base.href,
    service_documentation: DOCS,
    authorization_endpoint: at("/mcp/oauth/authorize"),
    token_endpoint: at("/mcp/oauth/token"),
    registration_endpoint: at("/mcp/oauth/register"),
    revocation_endpoint: at("/mcp/oauth/revoke"),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    revocation_endpoint_auth_methods_supported: ["client_secret_post"],
  };

  const session = requestSession(deps.garminClient);
  const serverDeps: ServerDeps = { config: deps.mcp, session, version: deps.version, files: inlineFiles };
  const tools = buildTools(serverDeps, HOSTED_TOOL_FACTORIES);

  const app = express();
  app.disable("x-powered-by");
  if (deps.trustProxy) app.set("trust proxy", 1);

  app.get("/mcp/healthz", (_req, res) => {
    res.type("text/plain").send("ok");
  });

  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata: metadata,
      resourceServerUrl: new URL("/mcp", base),
      resourceName: "Garmin Connect (unofficial)",
      serviceDocumentationUrl: new URL(DOCS),
    }),
  );
  app.use("/mcp/oauth/authorize", authorizationHandler({ provider, rateLimit: { windowMs: 60_000, limit: 60 } }));
  app.use("/mcp/oauth/token", tokenHandler({ provider, rateLimit: { windowMs: 60_000, limit: 30 } }));
  app.use(
    "/mcp/oauth/register",
    clientRegistrationHandler({ clientsStore: provider.clientsStore, clientIdGeneration: false, rateLimit: { windowMs: 3_600_000, limit: 10 } }),
  );
  app.use("/mcp/oauth/revoke", revocationHandler({ provider }));

  // Five tries per IP per 15 min also protects the server IP's standing with Garmin's login rate limits.
  const signInLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).set(pageHeaders()).send(errorPage("Too many sign-in attempts from your network. Wait 15 minutes and try again."));
    },
  });
  app.post(SIGN_IN_PATH, signInLimit, express.urlencoded({ extended: false, limit: "16kb" }), async (req, res) => {
    const outcome = await provider.handleSignIn((req.body ?? {}) as Record<string, string | undefined>);
    if (outcome.kind === "redirect") res.redirect(302, outcome.location);
    else res.status(outcome.status).set(outcome.headers).send(outcome.body);
  });

  const bearer = requireBearerAuth({ verifier: provider, resourceMetadataUrl: at("/.well-known/oauth-protected-resource/mcp") });
  const perGrant = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false, keyGenerator: (req) => accessOf(req).grantId });
  const handleMcp: RequestHandler = async (req, res) => {
    const { grantId, tokens } = accessOf(req);
    const started = Date.now();
    const server = serverForTools(tools, serverDeps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    res.on("finish", () => log({ grant: grantId.slice(0, 8), ...describeRpc(req.body), status: res.statusCode, ms: Date.now() - started }));
    await server.connect(transport);
    const onRejected = (error: unknown) => {
      if (isDeadSession(error)) deps.grants.revoke(grantId);
    };
    await session.run({ grantId, tokens, onRejected }, () => transport.handleRequest(req, res, req.body));
  };
  app.post("/mcp", bearer, perGrant, express.json({ limit: "15mb" }), handleMcp);

  const notAllowed: RequestHandler = (_req, res) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  };
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
  return app;
}
