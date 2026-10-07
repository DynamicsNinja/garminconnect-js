import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports
import { loadSqlite } from "../../src/http/grants.js";

// `npm run check -w mcp` builds before it tests; a bare vitest run without a build skips.
const BUNDLE = fileURLToPath(new URL("../../dist-http/http.mjs", import.meta.url));
const sqliteAvailable = loadSqlite() !== null;

describe.skipIf(!existsSync(BUNDLE) || !sqliteAvailable)("built hosted server", () => {
  it("starts from the single bundle and answers its health check", async () => {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const child = spawn(process.execPath, [BUNDLE], {
      env: { PATH: process.env["PATH"], PUBLIC_URL: `http://127.0.0.1:${port}`, PORT: String(port), SEAL_KEYS: randomBytes(32).toString("base64"), DB_PATH: path.join(mkdtempSync(path.join(os.tmpdir(), "dist-http-")), "g.db") },
      stdio: "ignore",
    });
    try {
      let body = "";
      for (let i = 0; i < 50 && body !== "ok"; i++) {
        await new Promise((r) => setTimeout(r, 100));
        body = await fetch(`http://127.0.0.1:${port}/mcp/healthz`).then((r) => r.text(), () => "");
      }
      expect(body).toBe("ok");
    } finally {
      child.kill();
    }
  }, 15_000);
});
