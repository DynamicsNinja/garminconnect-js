// Runs from the root `version` lifecycle (so `npm run bump -- <version>` covers it): copies the
// root package.json version into jsr.json, which npm does not know about.
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const jsr = JSON.parse(readFileSync("jsr.json", "utf8")) as { version: string };
if (jsr.version !== version) {
  jsr.version = version;
  writeFileSync("jsr.json", JSON.stringify(jsr, null, 2) + "\n");
}
