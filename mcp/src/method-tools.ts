import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { GARMIN_METHODS, type ManifestMethod } from "garminconnect-js/manifest";
import { localFiles, type FilesStrategy } from "./files.js";
import { jsonResult } from "./results.js";
import type { ServerDeps, ToolDef, ToolFactory } from "./server.js";
import { argumentValidator } from "./validate.js";

/** Methods deliberately NOT exposed, each with the reason. */
export const EXCLUDED: Readonly<Record<string, string>> = {
  logout: "Deletes the saved Garmin login; not something to do from a chat.",
  uploadWorkout: "Takes raw workout JSON, skipping the builder's checks. create_workout replaces it.",
  uploadRunningWorkout: "Raw workout JSON; create_workout replaces it.",
  uploadCyclingWorkout: "Raw workout JSON; create_workout replaces it.",
  uploadSwimmingWorkout: "Raw workout JSON; create_workout replaces it.",
  uploadStrengthWorkout: "Raw workout JSON; create_workout replaces it.",
  updateWorkout: "Raw workout JSON; update_workout (which takes a spec) replaces it.",
};

/** Methods exposed only when a config flag is on. */
export const OPT_IN: Readonly<Record<string, "enableGraphql">> = {
  queryGarminGraphql: "enableGraphql",
};

export const toolName = (method: string): string => method.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function inputSchemaOf(m: ManifestMethod, files: FilesStrategy): Tool["inputSchema"] {
  const properties: Record<string, object> = {};
  const required: string[] = [];
  for (const p of m.params) {
    if (p.role === "filename") continue; // derived from filePath
    if (p.role === "file") {
      const upload = files.uploadSchema();
      Object.assign(properties, upload.properties);
      required.push(...upload.required);
      continue;
    }
    properties[p.name] = p.schema;
    if (!p.optional) required.push(p.name);
  }
  return { type: "object", properties, ...(required.length > 0 && { required }), additionalProperties: false };
}

function descriptionOf(m: ManifestMethod): string {
  const base = m.requiresConnectPlus
    ? `Requires a Garmin Connect+ subscription (check with has_connect_plus). ${m.description}`
    : m.description;
  if (m.safety === "destructive") return `${base} IRREVERSIBLE: confirm with the user before calling.`;
  return base;
}

async function argsFor(m: ManifestMethod, input: Record<string, unknown>, files: FilesStrategy): Promise<unknown[]> {
  const args: unknown[] = [];
  let filename: string | undefined;
  for (const p of m.params) {
    if (p.role === "file") {
      const upload = await files.readUpload(input);
      filename = upload.filename;
      args.push(upload.blob);
    } else if (p.role === "filename") {
      args.push(filename);
    } else if (p.coerce === "date" && input[p.name] !== undefined) {
      const raw = input[p.name];
      if (typeof raw !== "string") {
        throw new Error(`${p.name}: expected an ISO 8601 date-time, got ${JSON.stringify(raw)}`);
      }
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) {
        throw new Error(`${p.name}: expected an ISO 8601 date-time, got ${JSON.stringify(raw)}`);
      }
      args.push(date);
    } else {
      args.push(input[p.name]);
    }
  }
  while (args.length > 0 && args[args.length - 1] === undefined) args.pop(); // let defaults apply
  return args;
}

function downloadName(m: ManifestMethod, input: Record<string, unknown>): string {
  const first = m.params[0] ? input[m.params[0].name] : undefined;
  const raw = typeof first === "string" || typeof first === "number" || typeof first === "boolean" ? String(first) : "file";
  const id = first === undefined ? "file" : raw.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 64);
  return `${toolName(m.name)}-${id}`;
}

function toolFor(m: ManifestMethod, deps: ServerDeps): ToolDef {
  const files = deps.files ?? localFiles(deps.config.downloadDir);
  const name = toolName(m.name);
  const inputSchema = inputSchemaOf(m, files);
  const checkArguments = argumentValidator(name, inputSchema);
  return {
    tool: {
      name,
      description: descriptionOf(m),
      inputSchema,
      annotations: {
        title: m.name,
        readOnlyHint: m.safety === "read",
        // MCP treats a MISSING destructiveHint as true, so writes say false explicitly.
        ...(m.safety !== "read" && { destructiveHint: m.safety === "destructive" }),
        openWorldHint: true,
      },
    },
    async run(input) {
      checkArguments(input);
      const args = await argsFor(m, input, files); // argument and file errors surface BEFORE any Garmin call
      const garmin = await deps.session.get();
      const fn = (garmin as unknown as Record<string, unknown>)[m.name];
      if (typeof fn !== "function") throw new Error(`garminconnect-js has no method ${m.name}`);
      const result: unknown = await (fn as (...a: unknown[]) => Promise<unknown>).apply(garmin, args);
      if (m.io === "binary-out") return files.deliverDownload(downloadName(m, input), result as Uint8Array);
      return jsonResult(result);
    },
  };
}

/** Every valid `GARMIN_MCP_GROUPS`/manifest `groups` value, taken from the manifest's own categories. */
export const KNOWN_GROUPS: ReadonlySet<string> = new Set(GARMIN_METHODS.map((m) => m.category));

/**
 * Resolves the caller's requested groups against the known set, case-insensitively and trimmed
 * (the extension's `groups` setting is free text, so a user can type `Workouts` or ` workouts `).
 * An unknown name is dropped, not fatal — this used to `throw`, which stopped the WHOLE server
 * (`method-tools.ts` is loaded before any tool is registered), turning a typo in a settings box
 * into "no Garmin tools at all" for an extension user with no terminal to see why. Unknown names
 * are reported on stderr (never stdout, which carries MCP frames) instead. If nothing requested
 * survives resolution, every group loads rather than none.
 */
function resolveGroups(requested: ReadonlySet<string> | null): ReadonlySet<string> | null {
  if (requested === null) return null;
  const byLower = new Map([...KNOWN_GROUPS].map((g) => [g.toLowerCase(), g]));
  const resolved = new Set<string>();
  const unknown: string[] = [];
  for (const raw of requested) {
    const match = byLower.get(raw.trim().toLowerCase());
    if (match) resolved.add(match);
    else unknown.push(raw);
  }
  if (unknown.length > 0) {
    process.stderr.write(
      `garminconnect-mcp: ignoring unknown GARMIN_MCP_GROUPS value(s): ${unknown.join(", ")}. Valid: ${[...KNOWN_GROUPS].sort().join(", ")}\n`,
    );
  }
  if (resolved.size === 0) {
    process.stderr.write("garminconnect-mcp: no valid GARMIN_MCP_GROUPS value remained; loading all tool groups.\n");
    return null;
  }
  return resolved;
}

export const methodTools: ToolFactory = (deps) => {
  const groups = resolveGroups(deps.config.groups);
  return GARMIN_METHODS.filter((m) => !Object.hasOwn(EXCLUDED, m.name))
    .filter((m) => !Object.hasOwn(OPT_IN, m.name) || deps.config[OPT_IN[m.name]!])
    .filter((m) => groups === null || groups.has(m.category))
    .map((m) => toolFor(m, deps));
};
