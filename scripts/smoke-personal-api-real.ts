/**
 * READ-ONLY: checks Garmin's Personal API OpenAPI spec against what `connectapi.garmin.com`
 * returns through this library's ordinary OAuth session, on a REAL account.
 *
 *   npm run smoke:personal-api                  # fetches the spec from developer.garmin.com
 *   npm run smoke:personal-api -- <openapi.json>  # or uses a local copy
 *
 * The spec (developer.garmin.com/gc-developer-program/personal/swagger-docs/, embedded in the
 * page's JS bundle) documents 26 GET endpoints on `personal.connectapi.garmin.com`. This calls the
 * same paths on our host and, per endpoint, diffs the response's KEY NAMES against the schema:
 * keys the spec lists that the response lacks, and keys the response has that the spec omits.
 *
 * Same safety as smoke-readonly-real.ts: GET-only transport, ./tokens-real, refuses the test
 * account. Output is key names and types, never values.
 */
import { readFileSync } from "node:fs";
import "./load-env.js";
import { GarminClient, Garmin, FileTokenStore, GarminHttpError } from "../src/index.js";
import { createReadOnlyFetch } from "./readonly-fetch.js";

type Schema = {
  $ref?: string;
  type?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  additionalProperties?: Schema | boolean;
  allOf?: Schema[];
};

const SWAGGER_PAGE = "https://developer.garmin.com/gc-developer-program/personal/swagger-docs/";

/**
 * The Swagger page links no spec file: the spec is inlined in the page's JS bundle as
 * `JSON.parse('{"openapi":…}')`. Fetched at run time rather than committed, because the
 * developer site's terms for redistributing it are unknown.
 */
async function fetchSpecText(): Promise<string> {
  const html = await (await fetch(SWAGGER_PAGE)).text();
  const bundle = /src="(\/component---src-pages-gc-developer-program-personal-swagger-docs-js-[^"]+\.js)"/.exec(html)?.[1];
  if (!bundle) throw new Error("swagger page layout changed: no swagger-docs bundle found");
  const js = await (await fetch(new URL(bundle, SWAGGER_PAGE))).text();
  const start = js.indexOf(`JSON.parse('{"openapi"`);
  if (start < 0) throw new Error("swagger bundle changed: no inlined OpenAPI spec found");
  const from = start + "JSON.parse('".length;
  const end = js.indexOf("')", from);
  // Undo the JS single-quoted string escaping in one pass, so `\\` and `\'` cannot interact.
  return js.slice(from, end).replace(/\\(['\\])/g, "$1");
}

// Optional: a local copy of the spec instead of fetching it.
const specPath = process.argv[2];
const spec = JSON.parse(specPath ? readFileSync(specPath, "utf8") : await fetchSpecText()) as {
  info: { version: string };
  paths: Record<string, { get: { responses: Record<string, { content?: Record<string, { schema: Schema }> }> } }>;
  components: { schemas: Record<string, Schema> };
};

const TOKEN_DIR = "./tokens-real";
const transport = createReadOnlyFetch();
const client = new GarminClient({ tokenStore: new FileTokenStore(TOKEN_DIR), fetchImpl: transport, retries: 0 });
if (!(await client.loadTokens())) {
  console.error(`No tokens in ${TOKEN_DIR}. Run \`npm run login:real\` first.`);
  process.exit(1);
}
const g = new Garmin(client);
const profile = await g.getUserProfile();
const testId = process.env["GARMIN_TEST_PROFILE_ID"];
if (testId && String(profile.profileId) === String(testId)) {
  console.error(`Refusing to run: ${TOKEN_DIR} holds the TEST account.`);
  process.exit(1);
}
const expectedReal = process.env["GARMIN_REAL_PROFILE_ID"];
if (expectedReal && String(profile.profileId) !== String(expectedReal)) {
  console.error("Refusing to run: live profile does not match GARMIN_REAL_PROFILE_ID.");
  process.exit(1);
}
console.log(
  `Read-only Personal API spec check (spec ${spec.info.version}, ${String(Object.keys(spec.paths).length)} paths) ` +
    "against a real account. Transport is GET-only.\n",
);

function resolve(s: Schema): Schema {
  let cur = s;
  for (let i = 0; i < 10; i++) {
    // springdoc wraps a described $ref property as `allOf: [{ $ref }]`.
    if (cur.allOf?.length === 1) cur = cur.allOf[0]!;
    else if (cur.$ref) cur = spec.components.schemas[cur.$ref.replace("#/components/schemas/", "")] ?? {};
    else break;
  }
  return cur;
}
const refName = (s: Schema): string =>
  s.$ref ? s.$ref.replace("#/components/schemas/", "") : s.items ? `${refName(s.items)}[]` : (s.type ?? "?");

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array[${String(v.length)}]`;
  return typeof v;
}

const diffs: string[] = [];

/** Diffs key names of `value` against `schema`, recursing into nested object schemas. */
function compare(value: unknown, schema: Schema, at: string, depth: number): void {
  const s = resolve(schema);
  if (value === null || value === undefined) return;
  if (s.type === "array" || s.items) {
    if (!Array.isArray(value)) {
      diffs.push(`${at}: spec says array, got ${typeOf(value)}; comparing it as one item`);
      if (s.items) compare(value, s.items, `${at}<item>`, depth);
      return;
    }
    const objs = value.filter((v) => v && typeof v === "object" && !Array.isArray(v)).slice(0, 25);
    if (objs.length === 0 || !s.items) return;
    const item = resolve(s.items);
    if (!item.properties) return;
    // Union of keys across the sampled rows, so one sparse row does not report false "missing".
    const merged: Record<string, unknown> = {};
    for (const o of objs) for (const [k, v] of Object.entries(o as object)) if (merged[k] == null) merged[k] = v;
    compare(merged, s.items, `${at}[]`, depth);
    return;
  }
  if (!s.properties) return;
  if (typeof value !== "object" || Array.isArray(value)) {
    diffs.push(`${at}: spec says object (${refName(schema)}), got ${typeOf(value)}`);
    return;
  }
  const obj = value as Record<string, unknown>;
  const specKeys = Object.keys(s.properties);
  const gotKeys = Object.keys(obj);
  const missing = specKeys.filter((k) => !(k in obj));
  const extra = gotKeys.filter((k) => !(k in s.properties!));
  const matched = specKeys.length - missing.length;
  diffs.push(
    `${at}: ${String(matched)}/${String(specKeys.length)} spec keys present` +
      (missing.length ? `\n      missing: ${missing.join(", ")}` : "") +
      (extra.length ? `\n      extra:   ${extra.map((k) => `${k}(${typeOf(obj[k])})`).join(", ")}` : ""),
  );
  if (depth >= 3) return;
  for (const k of specKeys) {
    const sub = s.properties[k]!;
    const r = resolve(sub);
    if ((r.properties || r.items) && obj[k] != null) compare(obj[k], sub, `${at}.${k}`, depth + 1);
  }
}

const day = (offset: number): string => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const D = day(1); // yesterday: a complete day, sleep already recorded
const S = day(7);

// Fill path params and query params per endpoint. activityId comes from the search result.
let activityId: string | undefined;
const routes: {
  path: string;
  build: () => { url: string; params?: Record<string, string | number> } | null;
  /** A failure this probe exists to show, not one to fix. */
  expectFail?: string;
}[] = [
  { path: "/activitylist-service/activities/search/activities", build: () => ({ url: "/activitylist-service/activities/search/activities", params: { start: 0, limit: 10 } }) },
  { path: "/activity-service/activity/{activityId}", build: () => (activityId ? { url: `/activity-service/activity/${activityId}` } : null) },
  { path: "/activity-service/activity/{activityId}/workouts", build: () => (activityId ? { url: `/activity-service/activity/${activityId}/workouts` } : null) },
  { path: "/biometric-service/heartRateZones/v2", build: () => ({ url: "/biometric-service/heartRateZones/v2" }) },
  { path: "/fitnessage-service/fitnessage/v2/{calendarDate}", build: () => ({ url: `/fitnessage-service/fitnessage/v2/${D}` }) },
  { path: "/goal-service/goal/user/effective/weightgoal/{startDate}/{endDate}", build: () => ({ url: `/goal-service/goal/user/effective/weightgoal/${S}/${D}` }) },
  { path: "/hrv-service/hrv/{calendarDate}", build: () => ({ url: `/hrv-service/hrv/${D}` }) },
  { path: "/hrv-service/hrv/daily/{fromDate}/{toDate}", build: () => ({ url: `/hrv-service/hrv/daily/${S}/${D}` }) },
  { path: "/nutrition-service/food/logs/{date}", build: () => ({ url: `/nutrition-service/food/logs/${D}` }) },
  { path: "/periodichealth-service/menstrualcycle/summary/{calendarDate}", build: () => ({ url: `/periodichealth-service/menstrualcycle/summary/${D}` }) },
  { path: "/periodichealth-service/menstrualcycle/dayview/{calendarDate}", build: () => ({ url: `/periodichealth-service/menstrualcycle/dayview/${D}`, params: { todayDate: day(0) } }) },
  { path: "/sleep-service/sleep/dailySleep", build: () => ({ url: "/sleep-service/sleep/dailySleep", params: { date: D } }) },
  { path: "/sleep-service/sleep/dailySleepSummariesByDate", build: () => ({ url: "/sleep-service/sleep/dailySleepSummariesByDate", params: { startDate: S, endDate: D } }) },
  { path: "/userprofile-service/userprofile/settings", build: () => ({ url: "/userprofile-service/userprofile/settings" }) },
  { path: "/usersummary-service/stats/hydration/daily/{startDate}/{endDate}", build: () => ({ url: `/usersummary-service/stats/hydration/daily/${S}/${D}` }) },
  { path: "/usersummary-service/stats/steps/daily/{startDate}/{endDate}", build: () => ({ url: `/usersummary-service/stats/steps/daily/${S}/${D}` }) },
  { path: "/usersummary-service/stats/stress/daily/{startDate}/{endDate}", build: () => ({ url: `/usersummary-service/stats/stress/daily/${S}/${D}` }) },
  { path: "/usersummary-service/usersummary/daily", build: () => ({ url: "/usersummary-service/usersummary/daily", params: { calendarDate: D } }) },
  { path: "/usersummary-service/v2/dailysummaries", build: () => ({ url: "/usersummary-service/v2/dailysummaries", params: { startDate: S, endDate: D } }) },
  { path: "/weight-service/weight/all/{startDate}/{endDate}", build: () => ({ url: `/weight-service/weight/all/${S}/${D}` }), expectFail: "7-day span; Garmin wants ~52 weeks" },
  { path: "/weight-service/weight/all/{startDate}/{endDate}", build: () => ({ url: `/weight-service/weight/all/${day(364)}/${D}` }) },
  { path: "/weight-service/weight/range/{startDate}/{endDate}", build: () => ({ url: `/weight-service/weight/range/${day(90)}/${D}`, params: { includeAll: "true" } }) },
  { path: "/wellness-service/wellness/bodyBattery/reports/daily", build: () => ({ url: "/wellness-service/wellness/bodyBattery/reports/daily", params: { startDate: S, endDate: D } }) },
  { path: "/wellness-service/wellness/daily/spo2acclimation/{calendarDate}", build: () => ({ url: `/wellness-service/wellness/daily/spo2acclimation/${D}` }) },
  { path: "/wellness-service/wellness/dailyHeartRate", build: () => ({ url: "/wellness-service/wellness/dailyHeartRate", params: { date: D } }) },
  { path: "/wellnessactivity-service/activity/summary/range/{fromDate}/{untilDate}", build: () => ({ url: `/wellnessactivity-service/activity/summary/range/${S}/${D}` }) },
];

const summary: string[] = [];
for (const r of routes) {
  const op = spec.paths[r.path]?.get;
  const schema = op?.responses["200"]?.content?.["application/json"]?.schema;
  const req = r.build();
  console.log(`\n== GET ${r.path}  (spec: ${schema ? refName(schema) : "?"})`);
  if (!req) {
    console.log("   SKIP  no activity id");
    summary.push(`SKIP ${r.path}`);
    continue;
  }
  try {
    const data = await client.connectapi<unknown>(req.url, req.params ? { params: req.params } : {});
    if (r.path.endsWith("/search/activities") && Array.isArray(data)) {
      const first = data.find((a) => a && typeof a === "object" && "activityId" in a) as { activityId?: number } | undefined;
      if (first?.activityId !== undefined) activityId = String(first.activityId);
    }
    console.log(`   OK    ${typeOf(data)}`);
    diffs.length = 0;
    if (schema) compare(data, schema, refName(schema), 0);
    for (const d of diffs) console.log(`   ${d}`);
    summary.push(`OK   ${r.path} -> ${typeOf(data)}${diffs[0] ? `  ${diffs[0].split("\n")[0]!.split(": ").slice(1).join(": ")}` : ""}`);
  } catch (e) {
    const msg = e instanceof GarminHttpError ? `HTTP ${String(e.status)} ${e.body.slice(0, 120)}` : `${(e as Error).constructor.name}: ${(e as Error).message.slice(0, 140)}`;
    const tag = r.expectFail ? `XFAIL (${r.expectFail})` : "FAIL";
    console.log(`   ${tag}  ${msg}`);
    summary.push(`${tag} ${r.path}  ${msg}`);
  }
}

// The one non-JSON endpoint: ZIP bytes.
console.log("\n== GET /download-service/files/activity/{activityId}");
if (activityId) {
  try {
    const buf = await client.download(`/download-service/files/activity/${activityId}`);
    const zip = buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b;
    console.log(`   OK    Buffer(${String(buf.length)} bytes), zip=${String(zip)}`);
    summary.push(`OK   /download-service/files/activity/{activityId} -> ${String(buf.length)} bytes, zip=${String(zip)}`);
  } catch (e) {
    const msg = e instanceof GarminHttpError ? `HTTP ${String(e.status)}` : (e as Error).message.slice(0, 140);
    console.log(`   FAIL  ${msg}`);
    summary.push(`FAIL /download-service/files/activity/{activityId}  ${msg}`);
  }
} else summary.push("SKIP /download-service/files/activity/{activityId}");

console.log("\n==== SUMMARY");
for (const s of summary) console.log(s);
const audit = transport.audit();
console.log(`\nRequests sent: ${Object.entries(audit.sent).map(([m, n]) => `${m}=${String(n)}`).join(", ")}. Refused as writes: ${String(audit.refused)}.`);
