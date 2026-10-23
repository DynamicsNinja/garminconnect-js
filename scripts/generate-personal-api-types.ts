/**
 * Generates `src/generated/personal-api.ts`: response types from Garmin's official Personal API
 * OpenAPI spec, exported from the package root as the `PersonalApi` namespace.
 *
 *   npm run personal-api-types                    # fetch the spec, write the file
 *   npm run personal-api-types -- <openapi.json>  # from a local copy
 *   npm run personal-api-types -- --check         # exit 1 if the file is out of date
 *
 * The Personal API is a separate, API-key product on `personal.connectapi.garmin.com`. This
 * library does not use it. It serves the SAME services we call on `connectapi.garmin.com`, and
 * `npm run smoke:personal-api` checked all 26 of its paths there on 2026-10-23: the field names
 * match. So the spec is the best field list there is for those responses.
 *
 * What the generator changes from the spec, each one observed on our host:
 *  - Every field is OPTIONAL and NULLABLE. Garmin leaves fields out when they are empty (a run has
 *    no swim cadence), so the spec's field list is what MAY appear, never what will.
 *  - Every interface keeps `[key: string]: unknown`: responses carry fields the spec does not list.
 *  - `LocalTime`, `ConnectDate` and `ConnectTimestamp` are plain strings on the wire, not the
 *    objects the spec describes.
 *  - Enums become open unions (`"A" | "B" | (string & {})`): Garmin adds values over time.
 *  - `/fitnessage-service/fitnessage/v2/{calendarDate}` returns ONE object, not an array.
 *
 * Field descriptions are deliberately NOT copied: the developer site's terms for redistributing
 * the spec are unknown. Names and types are facts about the API; the prose is Garmin's.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SWAGGER_PAGE, loadPersonalApiSpec, responseSchema, type OpenApiSchema } from "./lib/personal-api-spec.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = path.join(ROOT, "src", "generated", "personal-api.ts");

/** Spec schemas that are strings on the wire. */
const STRING_SCHEMAS = new Set(["LocalTime", "ConnectDate", "ConnectTimestamp"]);

/** Paths whose real response differs from the spec's declared one, by the type to use instead. */
const RESPONSE_OVERRIDES: Record<string, string> = {
  "/fitnessage-service/fitnessage/v2/{calendarDate}": "FitnessAgeDTO",
};

const args = process.argv.slice(2);
const check = args.includes("--check");
const spec = await loadPersonalApiSpec(args.find((a) => !a.startsWith("--")));
const schemas = spec.components.schemas;

const refName = (ref: string): string => ref.replace("#/components/schemas/", "");
const unwrap = (s: OpenApiSchema): OpenApiSchema => (s.allOf?.length === 1 ? unwrap(s.allOf[0]!) : s);

/** Schema names reachable from `s`, in first-seen order. */
function collect(s: OpenApiSchema, into: Set<string>): void {
  const u = unwrap(s);
  if (u.$ref) {
    const name = refName(u.$ref);
    if (into.has(name) || STRING_SCHEMAS.has(name)) return;
    into.add(name);
    collect(schemas[name] ?? {}, into);
    return;
  }
  for (const p of Object.values(u.properties ?? {})) collect(p, into);
  if (u.items) collect(u.items, into);
  if (typeof u.additionalProperties === "object") collect(u.additionalProperties, into);
}

function tsType(s: OpenApiSchema): string {
  const u = unwrap(s);
  if (u.$ref) {
    const name = refName(u.$ref);
    return STRING_SCHEMAS.has(name) ? "string" : name;
  }
  if (u.enum && u.enum.every((v) => typeof v === "string")) {
    return [...u.enum.map((v) => JSON.stringify(v)), "(string & {})"].join(" | ");
  }
  switch (u.type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array": {
      const item = u.items ? tsType(u.items) : "unknown";
      return /[|&]/.test(item) ? `(${item})[]` : `${item}[]`;
    }
    case "object":
      if (u.properties) return inlineObject(u);
      if (typeof u.additionalProperties === "object") return `Record<string, ${tsType(u.additionalProperties)}>`;
      return "Record<string, unknown>";
    default:
      return u.properties ? inlineObject(u) : "unknown";
  }
}

const key = (k: string): string => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));

function fields(s: OpenApiSchema, indent: string): string[] {
  const out = Object.entries(s.properties ?? {}).map(([k, v]) => {
    const t = tsType(v);
    const line = `${indent}${key(k)}?: ${t} | null;`;
    // A long top-level enum, one member per line. (An enum ARRAY starts with "(", stays inline.)
    if (line.length <= 100 || !t.startsWith('"')) return line;
    return [`${indent}${key(k)}?:`, ...[...t.split(" | "), "null"].map((m) => `${indent}  | ${m}`)].join("\n") + ";";
  });
  out.push(`${indent}[key: string]: unknown;`);
  return out;
}

function inlineObject(s: OpenApiSchema): string {
  return `{ ${fields(s, "").join(" ")} }`;
}

// Roots: every JSON response in the spec, in path order.
const reachable = new Set<string>();
const endpoints: [string, string][] = [];
for (const p of Object.keys(spec.paths)) {
  const schema = responseSchema(spec, p);
  if (!schema) continue; // the ZIP download
  collect(schema, reachable);
  endpoints.push([p, RESPONSE_OVERRIDES[p] ?? tsType(schema)]);
}

const lines: string[] = [
  "// GENERATED by scripts/generate-personal-api-types.ts. Do not edit; run `npm run personal-api-types`.",
  `// Source: ${spec.info.title} ${spec.info.version}, ${SWAGGER_PAGE}`,
  "// Field names and types only. See the generator for the corrections applied to the spec.",
  "",
  "/**",
  " * Response type of every JSON path in Garmin's Personal API spec, keyed by path. The same paths",
  " * answer on `connectapi.garmin.com`, the host this library uses.",
  " */",
  "export interface Endpoints {",
  ...endpoints.map(([p, t]) => `  ${JSON.stringify(p)}: ${t};`),
  "}",
];
// Spec order, so a spec update produces a readable diff.
for (const name of Object.keys(schemas)) {
  if (!reachable.has(name)) continue;
  const s = unwrap(schemas[name]!);
  lines.push("");
  if (!s.properties && s.type !== "object") {
    lines.push(`export type ${name} = ${tsType(s)};`);
    continue;
  }
  lines.push(`export interface ${name} {`, ...fields(s, "  "), "}");
}
const output = lines.join("\n") + "\n";

if (check) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    /* missing counts as stale */
  }
  if (current.replace(/\r\n/g, "\n") !== output) {
    console.error(`${path.relative(ROOT, OUT)} is out of date with the live spec; run \`npm run personal-api-types\`.`);
    process.exit(1);
  }
  console.log(`${path.relative(ROOT, OUT)} matches spec ${spec.info.version}.`);
} else {
  writeFileSync(OUT, output);
  console.log(`Wrote ${path.relative(ROOT, OUT)}: ${String(endpoints.length)} endpoints, ${String(reachable.size)} types.`);
}
