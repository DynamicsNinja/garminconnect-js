/**
 * Generates `docs/api/<category>.md` — one page per row of README's coverage table, listing every
 * method in that category with its signature and a copy-pasteable call.
 *
 *   npm run docs:api            # write the files
 *   npm run docs:api -- --check # fail if they are out of date (what CI runs, via the test)
 *
 * GENERATED, not written. 156 methods hand-documented in 11 files would be 156 chances for a
 * signature to drift from the code, and this project has already shipped that bug three times in
 * prose (a method count, a README coverage table, four source comments). Everything here comes
 * from two sources that cannot silently disagree with the library:
 *
 *  - `src/garmin.ts` — the method list, each one's parameters, and which service it delegates to,
 *    parsed from the actual class body. The service tells us the category.
 *  - `AGENTS.md`'s inventory table — the per-method notes and live-verification status, which are
 *    already guarded by `tests/agents-md.test.ts`.
 *
 * `tests/api-docs.test.ts` regenerates in memory and fails if the committed files differ, so the
 * pages cannot drift from the code without a test going red.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = path.join(ROOT, "docs", "api");

/** Service module -> the README coverage-table row it belongs to. */
const CATEGORIES: Record<string, { slug: string; title: string; blurb: string }> = {
  wellness: {
    slug: "wellness",
    title: "Wellness",
    blurb:
      "Daily health: steps, heart rate, sleep, HRV, stress, SpO2, respiration, hydration, blood " +
      "pressure and intensity minutes. Most take a calendar date.",
  },
  activities: {
    slug: "activities",
    title: "Activities",
    blurb:
      "Listing and searching activities, their detail (splits, weather, HR/power zones, exercise " +
      "sets), manual creation, file import/upload and download, and the activity/gear association.",
  },
  metrics: {
    slug: "metrics",
    title: "Training metrics",
    blurb:
      "Training status and readiness, race predictions, FTP, lactate threshold, heart-rate and " +
      "power zones, endurance and hill scores, fitness age.",
  },
  workouts: {
    slug: "workouts",
    title: "Workouts",
    blurb:
      "Workout CRUD, per-sport upload helpers, scheduling, and pushing to a device. For building " +
      "the workout JSON itself, see [WORKOUTS.md](../../WORKOUTS.md) — `buildWorkout` is far " +
      "easier than hand-writing it.",
  },
  gear: {
    slug: "gear",
    title: "Gear",
    blurb: "Shoes, bikes and other equipment: CRUD, stats, and which activity types they default to.",
  },
  devices: {
    slug: "devices",
    title: "Devices",
    blurb: "Registered Garmin devices, their settings, alarms and solar data.",
  },
  badges: {
    slug: "badges-challenges",
    title: "Badges & challenges",
    blurb: "Earned, available and in-progress badges, plus ad-hoc, badge and virtual challenges.",
  },
  weight: { slug: "body-composition-weight", title: "Body composition & weight", blurb: "" },
  bodyComposition: { slug: "body-composition-weight", title: "Body composition & weight", blurb: "" },
  womensHealth: {
    slug: "womens-health",
    title: "Women's health",
    blurb:
      "Menstrual-cycle tracking and pregnancy. **The write methods here are irreversible health-" +
      "data writes with no delete endpoint** — read the warning at the top of " +
      "`src/services/womensHealth.ts` before calling one.",
  },
  golf: { slug: "golf", title: "Golf", blurb: "Scorecards, shot data, club and player stats." },
  userProfile: { slug: "profile-and-misc", title: "Profile, goals, nutrition, plans & misc", blurb: "" },
  goals: { slug: "profile-and-misc", title: "Profile, goals, nutrition, plans & misc", blurb: "" },
  nutrition: { slug: "profile-and-misc", title: "Profile, goals, nutrition, plans & misc", blurb: "" },
  trainingPlans: { slug: "profile-and-misc", title: "Profile, goals, nutrition, plans & misc", blurb: "" },
  misc: { slug: "profile-and-misc", title: "Profile, goals, nutrition, plans & misc", blurb: "" },
};

const MERGED_BLURBS: Record<string, string> = {
  "body-composition-weight":
    "Weigh-ins and body-composition records. Note the unit asymmetry: writes send the raw value " +
    "in the unit you name, reads return GRAMS.",
  "profile-and-misc":
    "User profile and settings, goals, nutrition logs, training plans, and the odds and ends — " +
    "lifestyle logging, a data-reload request, the GraphQL passthrough, and `logout`.",
};

interface MethodDoc {
  name: string;
  params: string;
  service: string;
  signature: string;
  notes: string;
  verified: string;
}

/** Parses `src/garmin.ts`'s class body: each method's name, parameter list and target service. */
function parseGarminClass(): { name: string; params: string; service: string }[] {
  const source = readFileSync(path.join(ROOT, "src", "garmin.ts"), "utf8");
  const out: { name: string; params: string; service: string }[] = [];
  // `  methodName(a: T, b?: U): Ret {` … `return <service>.<fn>(this, …)`
  const re = /\n {2}([a-zA-Z][A-Za-z0-9]*)\(([^)]*)\)[^{]*\{\s*\n?\s*return (\w+)\./g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const [, name, params, service] = m;
    if (!name || name === "constructor") continue;
    out.push({ name, params: (params ?? "").replace(/\s+/g, " ").trim(), service: service ?? "" });
  }

  // Seven methods have a real body instead of a one-line delegation — the cached profile
  // accessors, and one womensHealth method that validates before delegating. Assigned by hand
  // here; `tests/api-docs.test.ts` fails if any Garmin method ends up in no page at all, so this
  // list cannot go stale silently.
  const HAND_PLACED: Record<string, { params: string; service: string }> = {
    getUserProfile: { params: "", service: "userProfile" },
    getUserSettings: { params: "", service: "userProfile" },
    displayName: { params: "", service: "userProfile" },
    fullName: { params: "", service: "userProfile" },
    userName: { params: "", service: "userProfile" },
    unitSystem: { params: "", service: "userProfile" },
    updateMenstrualCalendar: {
      params:
        "startdate: string | Date, enddate: string | Date, cycleDatesLists: (string | Date)[][], options?: object",
      service: "womensHealth",
    },
  };
  const seen = new Set(out.map((o) => o.name));
  for (const [name, info] of Object.entries(HAND_PLACED)) {
    if (!seen.has(name)) out.push({ name, ...info });
  }
  return out;
}

/** Signature, notes and verification status per method, from AGENTS.md's inventory table. */
function parseAgentsTable(): Map<string, { signature: string; notes: string; verified: string }> {
  const md = readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
  const map = new Map<string, { signature: string; notes: string; verified: string }>();
  for (const line of md.split("\n")) {
    if (!line.startsWith("| `")) continue;
    // Split on `|` that is NOT backslash-escaped, then unescape. Signatures in AGENTS.md write
    // TypeScript unions as `string \| Date`, and a naive split on "|" truncates them mid-type —
    // the first generated page rendered `cdate?: string \` and stopped.
    const cells = line.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
    const name = cells[1]?.replace(/`/g, "") ?? "";
    const detail = cells[2] ?? "";
    const verified = cells[cells.length - 2] ?? "";
    // The detail cell is "`(args): Promise<T>` — prose". Split on the first em dash.
    const dash = detail.indexOf("— ");
    const signature = (dash === -1 ? detail : detail.slice(0, dash)).trim().replace(/^`|`$/g, "");
    const notes = dash === -1 ? "" : detail.slice(dash + 2).trim();
    map.set(name, { signature, notes, verified });
  }
  return map;
}


/**
 * Every exported `interface`/`type` in `src/types/*.ts` plus `src/garmin.ts`, as raw declaration
 * text, keyed by name. Regex rather than a TypeScript AST on purpose: this package has zero
 * runtime dependencies and a parser would be the first, for a doc generator.
 */
function loadTypeDeclarations(): Map<string, string> {
  const decls = new Map<string, string>();
  const files = readdirSync(path.join(ROOT, "src", "types"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(ROOT, "src", "types", f));
  files.push(path.join(ROOT, "src", "garmin.ts"), path.join(ROOT, "src", "client.ts"));

  for (const file of files) {
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/^export interface (\w+) \{([\s\S]*?)^\}/gm)) {
      decls.set(m[1]!, m[2]!);
    }
    for (const m of source.matchAll(/^export type (\w+) = ([^;]+);/gm)) {
      decls.set(m[1]!, `= ${m[2]!.replace(/\s+/g, " ").trim()}`);
    }
  }
  return decls;
}

/** The `X` in `Promise<X>`, with `| null` stripped — the type a caller actually receives. */
function returnTypeOf(signature: string): string {
  const m = /:\s*Promise<([\s\S]+)>\s*$/.exec(signature.trim());
  if (!m) return "";
  return m[1]!.replace(/\s*\|\s*null\s*$/, "").trim();
}

/**
 * Renders what a caller gets back: the declared fields of the return type, or an honest note when
 * the shape is open. Garmin returns far more than this library models — almost every response
 * interface carries an index signature — and saying so is more useful than implying the field list
 * is exhaustive.
 */
function renderResponse(signature: string, decls: Map<string, string>): string[] {
  const out: string[] = [];
  const raw = returnTypeOf(signature);
  if (!raw) return out;

  const isArray = /\[\]$/.test(raw);
  const base = raw.replace(/\[\]$/, "").trim();
  const body = decls.get(base);

  out.push("**Returns**");
  out.push("");

  if (base === "void" || base === "unknown" || base === "") {
    out.push(
      base === "unknown"
        ? "`unknown` — Garmin's response is passed through unparsed. Cast it to whatever you need; " +
            "this library does not model it."
        : "Nothing.",
    );
    out.push("");
    return out;
  }
  if (/^Buffer$/.test(base)) {
    out.push("A `Buffer` of file bytes.");
    out.push("");
    return out;
  }
  if (!body) {
    out.push(`\`${raw}\``);
    out.push("");
    return out;
  }
  if (body.startsWith("= ")) {
    out.push(`\`${base}\` ${body}`);
    out.push("");
    return out;
  }

  const fields: string[] = [];
  let open = false;
  for (const line of body.split("\n")) {
    const text = line.trim();
    if (!text || text.startsWith("//") || text.startsWith("*") || text.startsWith("/*")) continue;
    if (/^\[key: string\]/.test(text)) {
      open = true;
      continue;
    }
    const f = /^(\w+)(\??):\s*(.+?);?$/.exec(text);
    if (f) fields.push(`| \`${f[1]!}\` | \`${f[3]!.replace(/;$/, "")}\` | ${f[2] ? "no" : "yes"} |`);
  }

  // An interface with an index signature and NO named fields models nothing at all. Printing
  // "`ActivitySplits`:" followed by an empty table reads like a rendering bug; say what is true.
  if (fields.length === 0 && open) {
    out.push(
      `${isArray ? `An array of \`${base}\`` : `\`${base}\``} — an object whose fields this ` +
        "library does not model. Garmin's response is passed through unparsed, so read one to see " +
        "what you get, or use a `Record<string, unknown>` and narrow it yourself.",
    );
    out.push("");
    return out;
  }

  out.push(isArray ? `An array of \`${base}\`:` : `\`${base}\`:`);
  out.push("");
  if (fields.length > 0) {
    out.push("| Field | Type | Always present |");
    out.push("|---|---|---|");
    out.push(...fields);
    out.push("");
  }
  if (open) {
    out.push(
      "Plus every other field Garmin sends: this type carries an index signature because the " +
        "real response is wider than the fields above, which are the ones this library relies on " +
        "or has observed. Read an actual response before depending on a field that is not listed.",
    );
    out.push("");
  }
  return out;
}

/** A plausible argument for a parameter, from its name and type. */
function exampleArg(param: string): string {
  const [rawName, rawType] = param.split(":").map((s) => s.trim());
  const name = (rawName ?? "").replace(/\?$/, "");
  const type = rawType ?? "";
  if (/^"/.test(type)) return type.split("|")[0]!.trim(); // a string-literal union
  if (/Date/.test(type) && /date|cdate|start|end|when|fordate/i.test(name)) return '"2026-09-24"';
  if (/number \| string/.test(type) || /Id$/i.test(name)) return "activityId";
  if (/number/.test(type)) return "1";
  if (/boolean/.test(type)) return "true";
  if (/string\[\]/.test(type)) return '["running"]';
  if (/string/.test(type)) return `"${name}"`;
  if (/Blob/.test(type)) return "file";
  if (/Record<|WorkoutInput|ActivityExerciseSets|WeightScaleFields/.test(type)) return "payload";
  return name || "value";
}

/** `await garmin.getSleepData("2026-09-24");` */
function exampleCall(m: MethodDoc): string {
  const required = m.params
    .split(/,(?![^<]*>)/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.includes("?:") && !p.includes("="));
  const args = required.map(exampleArg).join(", ");
  return `const result = await garmin.${m.name}(${args});`;
}

const VERDICT: Record<string, string> = {
  yes: "✅ live-verified",
  partially: "⚠️ partially verified",
  attempted: "⚠️ attempted, unconfirmed",
  no: "❌ not live-verified",
  "n/a": "— not applicable",
};

function verdictOf(verified: string): string {
  const first = verified.toLowerCase().replace(/\*/g, "").trim();
  for (const [key, label] of Object.entries(VERDICT)) {
    if (first.startsWith(key)) return label;
  }
  return "—";
}

/** Renders one category page. */
function renderPage(
  slug: string,
  title: string,
  blurb: string,
  methods: MethodDoc[],
  decls: Map<string, string>,
): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push("<!-- GENERATED by scripts/generate-api-docs.ts — do not edit by hand. -->");
  lines.push("");
  if (blurb) {
    lines.push(blurb);
    lines.push("");
  }
  lines.push(
    "Every method below hangs off a `Garmin` instance. See " +
      "[Installation & setup](../../README.md#-installation--setup) for how to construct one:",
  );
  lines.push("");
  lines.push("```ts");
  lines.push('import { GarminClient, Garmin, FileTokenStore } from "garminconnect-js";');
  lines.push("");
  lines.push('const client = new GarminClient({ tokenStore: new FileTokenStore("./tokens") });');
  lines.push('if (!(await client.loadTokens())) throw new Error("not connected to Garmin");');
  lines.push("const garmin = new Garmin(client);");
  lines.push("```");
  lines.push("");
  lines.push(`**${String(methods.length)} methods.** The verification column says what has been`);
  lines.push("confirmed against a live Garmin account, not merely unit-tested —");
  lines.push("[`AGENTS.md`](../../AGENTS.md) carries the full evidence per method.");
  lines.push("");
  lines.push("| Method | Verified |");
  lines.push("|---|---|");
  for (const m of methods) {
    lines.push(`| [\`${m.name}\`](#${m.name.toLowerCase()}) | ${verdictOf(m.verified)} |`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const m of methods) {
    lines.push(`## ${m.name}`);
    lines.push("");
    lines.push("```ts");
    lines.push(`garmin.${m.name}${m.signature || `(${m.params})`}`);
    lines.push("```");
    lines.push("");
    lines.push("```ts");
    lines.push(exampleCall(m));
    lines.push("```");
    lines.push("");
    lines.push(...renderResponse(m.signature, decls));
    if (m.notes) {
      lines.push(m.notes);
      lines.push("");
    }
    lines.push(`Verification: ${verdictOf(m.verified)}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Builds every page's content, keyed by filename. */
export function buildPages(): Map<string, string> {
  const agents = parseAgentsTable();
  const methods = parseGarminClass();
  const decls = loadTypeDeclarations();
  const bySlug = new Map<string, { title: string; blurb: string; methods: MethodDoc[] }>();

  for (const { name, params, service } of methods) {
    const category = CATEGORIES[service];
    if (!category) continue;
    const info = agents.get(name);
    const doc: MethodDoc = {
      name,
      params,
      service,
      signature: info?.signature ?? "",
      notes: info?.notes ?? "",
      verified: info?.verified ?? "",
    };
    const existing = bySlug.get(category.slug);
    if (existing) existing.methods.push(doc);
    else
      bySlug.set(category.slug, {
        title: category.title,
        blurb: MERGED_BLURBS[category.slug] ?? category.blurb,
        methods: [doc],
      });
  }

  const pages = new Map<string, string>();
  for (const [slug, { title, blurb, methods: list }] of [...bySlug].sort()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
    pages.set(`${slug}.md`, renderPage(slug, title, blurb, list, decls));
  }
  pages.set("README.md", renderIndex(pages, bySlug));
  return pages;
}

function renderIndex(
  pages: Map<string, string>,
  bySlug: Map<string, { title: string; blurb: string; methods: MethodDoc[] }>,
): string {
  const lines: string[] = [];
  lines.push("# API reference");
  lines.push("");
  lines.push("<!-- GENERATED by scripts/generate-api-docs.ts — do not edit by hand. -->");
  lines.push("");
  lines.push(
    "One page per category, with every method's signature and a call you can paste. For the " +
      "per-method gotchas and live-verification evidence, see [`AGENTS.md`](../../AGENTS.md); " +
      "for building workout JSON, see [`WORKOUTS.md`](../../WORKOUTS.md).",
  );
  lines.push("");
  lines.push("| Category | Methods |");
  lines.push("|---|---|");
  let total = 0;
  for (const [slug, { title, methods }] of [...bySlug].sort()) {
    total += methods.length;
    lines.push(`| [${title}](${slug}.md) | ${String(methods.length)} |`);
  }
  lines.push(`| **Total** | **${String(total)}** |`);
  lines.push("");
  return lines.join("\n");
}

// --- CLI ---------------------------------------------------------------------------------------
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const check = process.argv.includes("--check");
  const pages = buildPages();
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  let stale = 0;
  for (const [file, content] of pages) {
    const target = path.join(OUT_DIR, file);
    const current = existsSync(target) ? readFileSync(target, "utf8").replace(/\r\n/g, "\n") : null;
    if (current === content) continue;
    stale++;
    if (check) console.log(`  STALE  docs/api/${file}`);
    else writeFileSync(target, content);
  }
  if (check && stale > 0) {
    console.error(`\n${String(stale)} generated page(s) out of date. Run \`npm run docs:api\`.`);
    process.exit(1);
  }
  console.log(
    check
      ? `docs/api is up to date (${String(pages.size)} files).`
      : `Wrote ${String(pages.size)} file(s) to docs/api/.`,
  );
}
