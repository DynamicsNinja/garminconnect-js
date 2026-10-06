/**
 * Parsing shared by the generators that read the library's own source: `generate-api-docs.ts`
 * (docs/api pages) and `generate-manifest.ts` (the method manifest). One copy, so the two cannot
 * disagree about which category a method belongs to or what its notes say.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Service module -> the README coverage-table row it belongs to. */
export const CATEGORIES: Record<string, { slug: string; title: string; blurb: string }> = {
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
  courses: {
    slug: "courses",
    title: "Courses",
    blurb:
      "Saved routes you can send to a device and follow: import a GPX, create, rename, change " +
      "privacy, export as GPX, delete. Creating is two steps — " +
      "`importCourseGpx` parses, `createCourse` saves — and `createCourseFromGpx` does both.",
  },
  calendar: {
    slug: "calendar-events",
    title: "Calendar events",
    blurb:
      "Races and other dated events on the Garmin Connect calendar: list, read, create, update, " +
      "delete. Events you create are always private.",
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

/** Parses `src/garmin.ts`'s class body: each method's name, parameter list and target service. */
export function parseGarminClass(): { name: string; params: string; service: string }[] {
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

/** Signature, notes and verification status per method, from AGENTS.md's method table. */
export function parseAgentsTable(): Map<string, { signature: string; notes: string; verified: string }> {
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
 * Strips this repo's own process vocabulary out of a note before it reaches a consumer-facing
 * page. "fixed in Task 7's fix-round-1" and "see the repo-wide safety note this task shipped with"
 * are meaningful in the development history and meaningless to someone who installed the package:
 * they name artefacts the reader cannot see. The FACT usually survives on its own ("returns an
 * ARRAY" keeps its value once the history clause is gone).
 */
export function stripInternalNotes(notes: string): string {
  const cleaned = notes
    .replace(/\s*;\s*(?=;)/g, "")
    .replace(/^[\s;,.]+/, "")
    .replace(/[\s;,]+$/, "")
    .replace(/\s{2,}/g, " ");
  // Process-history clauses are dropped WHOLE, to the end of the note. An earlier version tried to
  // excise them mid-sentence and produced "— .test.ts`": the pattern ran into a backticked
  // filename and stopped at its dot. A half-removed sentence is worse than the sentence, so each
  // rule here either takes a complete clause or leaves it alone.
  return cleaned
    .replace(/\s*\(fixed in Task \d+'s fix-round-\d+[^)]*\)/gi, "")
    .replace(/,?\s*(?:and\s+)?see the repo-wide safety note this task shipped with/gi, "")
    .replace(/\bthis task's\b/gi, "this library's")
    .replace(/\bTask \d+'s\b/gi, "an earlier")
    .replace(/\s*\(Task \d+\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s;,.]+/, "")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/[\s;,]+$/, "");
}
