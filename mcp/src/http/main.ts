/**
 * The hosted server process (Docker: `node http.mjs`).
 *   node http.mjs                     serve
 *   node http.mjs revoke <grant_id>   disconnect one connection
 *   node http.mjs revoke --all        disconnect everyone
 */
import { describeError } from "../errors.js";
import { loadHostedConfig } from "./config.js";
import { createHttpApp } from "./app.js";
import { garminAuth } from "./garmin-auth.js";
import { purgeSafely, SqliteGrantStore } from "./grants.js";
import { Sealer } from "./seal.js";

const version = __MCP_VERSION__;
const now = () => Math.floor(Date.now() / 1000);
const log = (line: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), ...line }));

try {
  const config = loadHostedConfig();
  const grants = await SqliteGrantStore.open(config.dbPath);

  if (process.argv[2] === "revoke") {
    const target = process.argv[3];
    if (!target) {
      console.error("usage: node http.mjs revoke <grant_id> | --all");
      process.exit(2);
    }
    const n = target === "--all" ? grants.revokeAll() : Number(grants.revoke(target));
    console.log(`Revoked ${n} connection(s).`);
    grants.close();
    process.exit(0);
  }

  const purged = purgeSafely(grants, now(), log);
  setInterval(() => {
    const n = purgeSafely(grants, now(), log);
    if (n !== null) log({ msg: "purge", purged: n });
  }, 86_400_000).unref();
  const app = createHttpApp({ publicUrl: config.publicUrl, sealer: new Sealer(config.keys), grants, auth: garminAuth(), mcp: config.mcp, version, trustProxy: config.trustProxy, log });
  const server = app.listen(config.port, "0.0.0.0", () => log({ msg: "listening", port: config.port, version, purged, ...grants.count() }));
  const stop = () => server.close(() => {
    grants.close();
    process.exit(0);
  });
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
} catch (error) {
  console.error(describeError(error));
  process.exit(1);
}
