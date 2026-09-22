import { describe, expect, it } from "vitest";
import { GarminClient } from "../../src/client.js";
import { Garmin } from "../../src/garmin.js";
import { FileTokenStore } from "../../src/auth/token-store.js";

const dir = process.env["GARMIN_TOKENS"] ?? "./tokens";
const hasCredentials = Boolean(process.env["GARMIN_EMAIL"] && process.env["GARMIN_PASSWORD"]);

/**
 * Opt-in: this is how you find out Garmin changed the SSO flow.
 * Run with `npm run test:live` after `npm run login`.
 */
describe.skipIf(!hasCredentials)("live smoke", () => {
  it("logs in fresh and reads the profile", async () => {
    const client = new GarminClient();
    const result = await client.login(
      process.env["GARMIN_EMAIL"]!,
      process.env["GARMIN_PASSWORD"]!,
    );
    if (result.state === "mfa_required") {
      console.warn("MFA required — skipping fresh-login assertion; use stored tokens");
      return;
    }
    const profile = await new Garmin(client).getUserProfile();
    expect(profile.displayName).toBeTruthy();
  });

  it("reads yesterday's summary from stored tokens", async () => {
    const client = new GarminClient({ tokenStore: new FileTokenStore(dir) });
    if (!(await client.loadTokens())) {
      console.warn(`No tokens in ${dir}; run npm run login first`);
      return;
    }
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const summary = await new Garmin(client).getUserSummary(yesterday);
    expect(summary).toBeTypeOf("object");
  });
});
