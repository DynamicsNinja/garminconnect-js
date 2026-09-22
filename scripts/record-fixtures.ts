/**
 * Refreshes recorded fixtures from the live API.
 *   npx tsx scripts/record-fixtures.ts ./tokens
 * Requires tokens produced by scripts/login.ts. Output is scrubbed before writing.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GarminClient } from "../src/client.js";
import { Garmin } from "../src/garmin.js";
import { FileTokenStore } from "../src/auth/token-store.js";
import { scrub } from "../tests/helpers/scrub.js";

const dir = process.argv[2] ?? "./tokens";
const out = "tests/fixtures";
const date = process.argv[3] ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

const client = new GarminClient({ tokenStore: new FileTokenStore(dir) });
if (!(await client.loadTokens())) {
  console.error(`No tokens in ${dir}. Run scripts/login.ts first.`);
  process.exit(1);
}
const garmin = new Garmin(client);

const captures: [string, () => Promise<unknown>][] = [
  ["social-profile", () => garmin.getUserProfile()],
  ["user-summary", () => garmin.getUserSummary(date)],
  ["steps", () => garmin.getStepsData(date)],
  ["heart-rates", () => garmin.getHeartRates(date)],
  ["sleep", () => garmin.getSleepData(date)],
  ["hrv", () => garmin.getHrvData(date)],
  ["body-battery", () => garmin.getBodyBattery(date)],
  ["activities", () => garmin.getActivities(0, 5)],
];

await mkdir(out, { recursive: true });
for (const [name, fetchOne] of captures) {
  try {
    const data = await fetchOne();
    await writeFile(join(out, `${name}.json`), JSON.stringify(scrub(data), null, 2) + "\n");
    console.log(`recorded ${name}`);
  } catch (error) {
    console.error(`FAILED ${name}:`, error instanceof Error ? error.message : error);
  }
}
