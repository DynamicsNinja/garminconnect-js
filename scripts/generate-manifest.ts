/**
 * Generates `src/generated/manifest.ts`: a machine-readable description of every `Garmin` method.
 *
 *   npm run manifest            # write the file
 *   npm run manifest -- --check # exit 1 if it is out of date
 *
 * It exists so tools built ON this library (the MCP server in `mcp/`) are generated from it rather
 * than hand-maintained. Types come from the TypeScript compiler, not regexes, so a parameter's
 * schema is read exactly the way `tsc` reads its declaration. TypeScript is a devDependency; this
 * runs at build time only and adds nothing to the published package's dependencies.
 *
 * Two things FAIL the run rather than guess, because both need a human decision:
 *  - a method whose name fits no safety rule (add it to SAFETY_OVERRIDES);
 *  - a parameter type with no JSON Schema equivalent.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { JsonSchema, ManifestMethod, ManifestParam, Safety } from "../src/manifest.js";
import { CATEGORIES, parseAgentsTable, parseGarminClass, stripInternalNotes } from "./lib/garmin-source.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GARMIN_TS = path.join(ROOT, "src", "garmin.ts");
export const MANIFEST_PATH = path.join(ROOT, "src", "generated", "manifest.ts");
const MAX_DESCRIPTION = 600;

const READ_PREFIXES = ["get", "list", "count", "download"];
const DESTRUCTIVE_PREFIXES = ["delete", "unschedule"];
const WRITE_PREFIXES = [
  "set", "add", "create", "import", "upload", "update", "remove", "push", "schedule", "init", "confirm", "request", "query",
];

/** Exceptions to the prefix rules, each with its reason. */
export const SAFETY_OVERRIDES: Readonly<Record<string, Safety>> = {
  // Cached accessors over getUserProfile/getUserSettings: no prefix, pure reads.
  displayName: "read",
  fullName: "read",
  userName: "read",
  unitSystem: "read",
  // Deletes the saved login.
  logout: "destructive",
  // FULL REPLACE, not a merge: whatever is stored for that day/activity is overwritten.
  updateMenstrualDailyLog: "destructive",
  updateMenstrualCalendar: "destructive",
  setActivityExerciseSets: "destructive",
  // Replaces the WHOLE defaults list for the gear, not a merge: `[]` clears every default.
  setGearActivityDefaults: "destructive",
  // Runs an arbitrary GraphQL body verbatim; a mutation looks the same as a query at this layer.
  queryGarminGraphql: "destructive",
  // Food logging: a catalogue search, and two writes that add an entry to the day's log.
  searchFoods: "read",
  logFood: "write",
  quickAddFood: "write",
};

export function classify(name: string): Safety {
  if (Object.hasOwn(SAFETY_OVERRIDES, name)) return SAFETY_OVERRIDES[name]!;
  const has = (prefixes: string[]) => prefixes.some((p) => name.startsWith(p) && /^[A-Z]/.test(name.slice(p.length)));
  if (has(READ_PREFIXES)) return "read";
  if (has(DESTRUCTIVE_PREFIXES)) return "destructive";
  if (has(WRITE_PREFIXES)) return "write";
  throw new Error(
    `generate-manifest: cannot classify "${name}" as read, write or destructive. ` +
      "Add it to SAFETY_OVERRIDES in scripts/generate-manifest.ts.",
  );
}

const NULLISH = ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void;
const DATE: JsonSchema = { type: "string", format: "date", description: "Calendar date, YYYY-MM-DD (UTC)" };

/**
 * A symbol's doc comment, with line endings normalised. A multi-line comment carries the line
 * endings of the checkout it was read from: CRLF on a Windows clone, LF on CI. Left alone they
 * end up as "\r\n" inside the JSON strings, so the same commit generated different manifests on
 * the two platforms and the drift test failed in CI only.
 */
const docOf = (symbol: ts.Symbol, checker: ts.TypeChecker): string =>
  ts.displayPartsToString(symbol.getDocumentationComment(checker)).replace(/\r\n?/g, "\n").trim();
// A BARE `Date` param (not `string | Date`) is a moment in time, not a calendar date: methods like
// `setBloodPressure`/`addHydrationData`/`addWeighIn`/`addWeighInWithTimestamps` pass it straight to
// `formatLocalTimestamp`, which throws if handed a plain string. `paramsOf` marks such params
// `coerce: "date"` so a caller like the MCP server can convert a JSON string to a real `Date`
// before invoking the method.
const DATETIME: JsonSchema = {
  type: "string",
  format: "date-time",
  description: "A moment in time, ISO 8601, e.g. 2026-09-28T07:30:00 (local) or with Z/offset",
};
const isNamed = (t: ts.Type, name: string) => t.getSymbol()?.getName() === name;

function unmappable(type: ts.Type, checker: ts.TypeChecker, where: string): Error {
  return new Error(`generate-manifest: ${where}: cannot map type "${checker.typeToString(type)}" to JSON Schema`);
}

export function typeToSchema(
  type: ts.Type,
  checker: ts.TypeChecker,
  where: string,
  seen: ReadonlySet<ts.Type> = new Set(),
): JsonSchema {
  if (type.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) return { description: "Any JSON value" };
  if (type.isUnion()) return unionToSchema(type, checker, where, seen);
  if (type.flags & ts.TypeFlags.StringLiteral) return { type: "string", enum: [(type as ts.StringLiteralType).value] };
  if (type.flags & ts.TypeFlags.NumberLiteral) return { type: "number", enum: [(type as ts.NumberLiteralType).value] };
  if (type.flags & ts.TypeFlags.BooleanLiteral) return { type: "boolean" };
  if (type.flags & ts.TypeFlags.String) return { type: "string" };
  if (type.flags & ts.TypeFlags.Number) return { type: "number" };
  if (type.flags & ts.TypeFlags.Boolean) return { type: "boolean" };
  if (isNamed(type, "Date")) return DATETIME;
  if (checker.isTupleType(type)) {
    const items = checker
      .getTypeArguments(type as ts.TypeReference)
      .map((t, i) => typeToSchema(t, checker, `${where}[${i}]`, seen));
    return { type: "array", prefixItems: items, minItems: items.length, maxItems: items.length };
  }
  if (checker.isArrayType(type)) {
    const [item] = checker.getTypeArguments(type as ts.TypeReference);
    return { type: "array", items: typeToSchema(item!, checker, `${where}[]`, seen) };
  }
  if (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) return objectToSchema(type, checker, where, seen);
  throw unmappable(type, checker, where);
}

function unionToSchema(type: ts.UnionType, checker: ts.TypeChecker, where: string, seen: ReadonlySet<ts.Type>): JsonSchema {
  const parts = type.types.filter((t) => !(t.flags & NULLISH));
  if (parts.length === 0) throw unmappable(type, checker, where);
  if (parts.every((t) => t.flags & ts.TypeFlags.StringLiteral)) {
    return { type: "string", enum: parts.map((t) => (t as ts.StringLiteralType).value) };
  }
  if (parts.every((t) => t.flags & ts.TypeFlags.BooleanLiteral)) return { type: "boolean" };
  const hasString = parts.some((t) => t.flags & ts.TypeFlags.String);
  if (parts.length === 2 && hasString && parts.some((t) => isNamed(t, "Date"))) return DATE;
  if (parts.length === 2 && hasString && parts.some((t) => t.flags & ts.TypeFlags.Number)) {
    return { type: ["integer", "string"], description: "Numeric id" };
  }
  if (parts.length === 1) return typeToSchema(parts[0]!, checker, where, seen);
  return { anyOf: parts.map((t, i) => typeToSchema(t, checker, `${where}|${i}`, seen)) };
}

function objectToSchema(type: ts.Type, checker: ts.TypeChecker, where: string, seen: ReadonlySet<ts.Type>): JsonSchema {
  if (seen.has(type)) {
    return { type: "object", description: `Recursive: same shape as the enclosing ${checker.typeToString(type)}` };
  }
  if (type.getCallSignatures().length > 0) throw unmappable(type, checker, where);
  const inner = new Set(seen).add(type);
  const index = checker.getIndexInfoOfType(type, ts.IndexKind.String);
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const prop of checker.getPropertiesOfType(type)) {
    const name = prop.getName();
    const schema = typeToSchema(checker.getTypeOfSymbol(prop), checker, `${where}.${name}`, inner);
    const doc = docOf(prop, checker);
    properties[name] = doc ? { ...schema, description: doc } : schema;
    if (!(prop.flags & ts.SymbolFlags.Optional)) required.push(name);
  }
  if (Object.keys(properties).length === 0 && !index) throw unmappable(type, checker, where);
  const additional = !index
    ? false
    : index.type.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)
      ? true
      : typeToSchema(index.type, checker, `${where}[key]`, inner);
  return {
    type: "object",
    ...(Object.keys(properties).length > 0 && { properties }),
    ...(required.length > 0 && { required }),
    additionalProperties: additional,
  };
}

/** Param names this library and Garmin's own API treat as an id, for the `number | string` wording. */
const ID_LIKE_NAME = /(?:id|pk|uuid)$/i;

function paramsOf(member: ts.MethodDeclaration, checker: ts.TypeChecker, method: string): ManifestParam[] {
  const out: ManifestParam[] = [];
  member.parameters.forEach((param, i) => {
    const name = param.name.getText();
    const optional = param.questionToken !== undefined || param.initializer !== undefined;
    const type = checker.getTypeAtLocation(param);
    if (isNamed(checker.getNonNullableType(type), "Blob")) {
      out.push({ name, optional, role: "file", schema: { description: "File contents" } });
    } else if (out[i - 1]?.role === "file" && name === "filename") {
      out.push({ name, optional, role: "filename", schema: { type: "string" } });
    } else {
      const schema = typeToSchema(type, checker, `${method}(${name})`);
      const p: ManifestParam = { name, optional, schema };
      if (schema["format"] === "date-time") p.coerce = "date";
      if (Array.isArray(schema["type"]) && (schema["type"] as unknown[]).includes("integer")) {
        // number|string union: `typeToSchema` doesn't know the param name, so decide the
        // "id" wording here — `activityId`/`gearUUID` get it, `year`/`month` do not.
        const { description: _unused, ...rest } = schema;
        p.schema = ID_LIKE_NAME.test(name) ? { ...rest, description: "Numeric id" } : rest;
      }
      out.push(p);
    }
  });
  return out;
}

function returnsBuffer(member: ts.MethodDeclaration, checker: ts.TypeChecker): boolean {
  const signature = checker.getSignatureFromDeclaration(member);
  if (!signature) return false;
  let t = checker.getReturnTypeOfSignature(signature);
  if (isNamed(t, "Promise")) t = checker.getTypeArguments(t as ts.TypeReference)[0] ?? t;
  return isNamed(t, "Buffer");
}

const humanize = (name: string) => {
  const words = name.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}.`;
};

/**
 * `stripInternalNotes` (garmin-source.ts) removes AGENTS.md's process vocabulary, which is shared
 * with `docs/api` generation. This removes a second layer of purely INTERNAL jargon that only
 * makes sense to someone developing this library, not someone calling a tool — "passes through
 * unchecked", "(see gotchas)"/"See gotchas", "no proven inverse write ... in this task". Kept
 * manifest-only (not in `stripInternalNotes`) so `docs/api`'s prose, which IS for a developer of
 * this library, is unaffected.
 */
function stripJargon(text: string): string {
  return text
    .replace(/[,;]?\s*passes through unchecked\.?/gi, "")
    .replace(/no proven inverse write[^.;]*/gi, "")
    .replace(/\(see gotchas\)/gi, "")
    // "see gotchas for X" points at a doc the reader of a tool description cannot see, so the
    // whole clause goes, up to the next sentence break. A following ":" is kept.
    .replace(/[,;]?\s*see gotchas\b[^.;:]*/gi, "")
    .replace(/UNCERTAIN[^.;]*[.;]?/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    // Collapse only the doubled punctuation a removal leaves behind. A blanket /[.;]{2,}/ also
    // ate every literal "..." (path elisions like `/heartRate/...`, `post(...)`) in the notes.
    .replace(/;\s*\./g, ".")
    .replace(/\.\s*;/g, ".")
    .replace(/;{2,}/g, ";")
    .replace(/(?<!\.)\.\.(?!\.)/g, ".")
    .replace(/^[\s;,.]+/, "")
    .replace(/[\s;,]+$/, "")
    .trim();
}

function describe(
  name: string,
  member: ts.MethodDeclaration,
  checker: ts.TypeChecker,
  notes: ReturnType<typeof parseAgentsTable>,
): string {
  const note = stripJargon(stripInternalNotes(notes.get(name)?.notes ?? ""));
  const symbol = checker.getSymbolAtLocation(member.name);
  const doc = symbol ? docOf(symbol, checker) : "";
  const text = (note || doc || humanize(name)).replace(/\s+/g, " ").trim();
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text;
}

export function buildManifest(): ManifestMethod[] {
  const program = ts.createProgram([GARMIN_TS], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    // Same libs as tsconfig.json. Without this TypeScript adds the DOM lib, so a Garmin type that
    // happened to share a name with a browser global could resolve to the wrong declaration.
    lib: ["lib.es2022.d.ts"],
    strict: true,
    types: ["node"],
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(GARMIN_TS);
  const cls = source?.statements.find(
    (s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === "Garmin",
  );
  if (!cls) throw new Error("generate-manifest: class Garmin not found in src/garmin.ts");

  const services = new Map(parseGarminClass().map((m) => [m.name, m.service]));
  const notes = parseAgentsTable();
  const methods: ManifestMethod[] = [];
  for (const member of cls.members) {
    // Skips the constructor, fields, and #private members (their names are PrivateIdentifiers).
    if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue;
    const name = member.name.text;
    const service = services.get(name);
    const category = service !== undefined && Object.hasOwn(CATEGORIES, service) ? CATEGORIES[service]!.slug : undefined;
    if (!category) {
      throw new Error(
        `generate-manifest: no category for ${name} (service "${service ?? "?"}"). ` +
          "See HAND_PLACED in parseGarminClass (scripts/lib/garmin-source.ts).",
      );
    }
    const params = paramsOf(member, checker, name);
    methods.push({
      name,
      category,
      description: describe(name, member, checker, notes),
      params,
      safety: classify(name),
      io: params.some((p) => p.role === "file") ? "binary-in" : returnsBuffer(member, checker) ? "binary-out" : "json",
    });
  }
  return methods;
}

export function renderManifest(methods: ManifestMethod[]): string {
  return [
    "// GENERATED by scripts/generate-manifest.ts. Do not edit; run `npm run manifest`.",
    "// tests/manifest.test.ts fails if this file is out of date.",
    'import type { ManifestMethod } from "../manifest.js";',
    "",
    `export const GARMIN_METHODS: readonly ManifestMethod[] = ${JSON.stringify(methods, null, 2)};`,
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const expected = renderManifest(buildManifest());
  if (process.argv.includes("--check")) {
    const current = readFileSync(MANIFEST_PATH, "utf8").replace(/\r\n/g, "\n");
    if (current !== expected) {
      console.error("src/generated/manifest.ts is out of date. Run `npm run manifest`.");
      process.exit(1);
    }
    console.log("src/generated/manifest.ts is up to date.");
  } else {
    mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
    writeFileSync(MANIFEST_PATH, expected);
    console.log(`Wrote ${expected.match(/"name": "[a-z]/g)?.length ?? 0} method entries to src/generated/manifest.ts`);
  }
}
