import { loadConfig, type McpConfig } from "../session.js";
import { parseSealKeys } from "./seal.js";

export interface HostedConfig {
  publicUrl: URL;
  keys: Buffer[];
  dbPath: string;
  port: number;
  trustProxy: boolean;
  /** Lower-case name of a header carrying the real client IP (e.g. cf-connecting-ip), or null. */
  clientIpHeader: string | null;
  /** Tool settings shared with stdio: GARMIN_MCP_GROUPS, GARMIN_MCP_ENABLE_GRAPHQL. */
  mcp: McpConfig;
}

export function loadHostedConfig(env: Record<string, string | undefined> = process.env): HostedConfig {
  const rawUrl = env["PUBLIC_URL"]?.trim();
  if (!rawUrl) throw new Error("PUBLIC_URL is not set (e.g. https://garmin.ficdev.xyz)");
  const publicUrl = new URL(rawUrl);
  const local = publicUrl.hostname === "localhost" || publicUrl.hostname === "127.0.0.1";
  if (publicUrl.protocol !== "https:" && !local) throw new Error("PUBLIC_URL must be https (plain http is allowed only for localhost)");
  const keys = parseSealKeys(env["SEAL_KEYS"]);
  const dbPath = env["DB_PATH"]?.trim();
  if (!dbPath) throw new Error("DB_PATH is not set (e.g. /data/grants.db)");
  const port = Number(env["PORT"] ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`PORT must be a port number, got ${env["PORT"]}`);
  const clientIpHeader = env["CLIENT_IP_HEADER"]?.trim().toLowerCase() || null;
  if (clientIpHeader !== null && !/^[a-z0-9-]+$/.test(clientIpHeader)) throw new Error(`CLIENT_IP_HEADER must be a header name (letters, digits, hyphens), got ${env["CLIENT_IP_HEADER"]}`);
  return { publicUrl, keys, dbPath, port, trustProxy: env["TRUST_PROXY"] === "1", clientIpHeader, mcp: loadConfig(env) };
}
