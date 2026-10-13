// Runs from the root `version` lifecycle (so `npm run bump -- <version>` covers it): copies the
// root package.json version into the manifests npm does not know about, jsr.json (JSR) and
// mcp/server.json (the official MCP Registry).
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
for (const file of ["jsr.json", "mcp/server.json"]) {
  const json = JSON.parse(readFileSync(file, "utf8")) as { version: string };
  if (json.version === version) continue;
  json.version = version;
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
}
