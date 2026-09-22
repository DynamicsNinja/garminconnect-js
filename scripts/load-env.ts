/**
 * Load environment variables from a .env file in the repo root.
 * Does nothing if the file does not exist.
 * Does not override variables already set in process.env.
 *
 * Usage:
 *   import "./load-env.js";
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");

/**
 * Parse lines from a .env file and apply them to process.env.
 * Exported for testing.
 */
export function parseDotEnv(
  content: string,
  env: Record<string, string | undefined>,
): Record<string, string> {
  const loaded: Record<string, string> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    // Skip blank lines and comments
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] === "#") {
      continue;
    }

    // Parse KEY=value (split on first = only)
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      // Malformed line — skip it
      continue;
    }

    const key = line.substring(0, eqIndex).trim();
    let value = line.substring(eqIndex + 1).trim();

    // Skip if key is empty
    if (!key) {
      continue;
    }

    // Do not override already-set env vars
    if (env[key] !== undefined) {
      continue;
    }

    // Strip a single matching pair of surrounding quotes
    if (
      (value[0] === '"' && value[value.length - 1] === '"') ||
      (value[0] === "'" && value[value.length - 1] === "'")
    ) {
      value = value.slice(1, -1);
    }

    loaded[key] = value;
    env[key] = value;
  }

  return loaded;
}

function loadEnv(): void {
  let content: string;
  try {
    content = readFileSync(envPath, "utf-8");
  } catch (error) {
    // File doesn't exist or can't be read — nothing to do.
    return;
  }

  parseDotEnv(content, process.env);
}

loadEnv();
