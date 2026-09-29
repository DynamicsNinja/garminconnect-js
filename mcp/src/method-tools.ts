import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { GARMIN_METHODS, type ManifestMethod } from "garminconnect-js/manifest";
import { readUpload, saveDownload } from "./files.js";
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

function inputSchemaOf(m: ManifestMethod): Tool["inputSchema"] {
  const properties: Record<string, object> = {};
  const required: string[] = [];
  for (const p of m.params) {
    if (p.role === "filename") continue; // derived from filePath
    if (p.role === "file") {
      properties["filePath"] = {
        type: "string",
        description: "Absolute path to a local .fit, .gpx or .tcx file (~ is expanded)",
      };
      required.push("filePath");
      continue;
    }
    properties[p.name] = p.schema;
    if (!p.optional) required.push(p.name);
  }
  return { type: "object", properties, ...(required.length > 0 && { required }), additionalProperties: false };
}

function descriptionOf(m: ManifestMethod): string {
  if (m.safety === "destructive") return `${m.description} IRREVERSIBLE: confirm with the user before calling.`;
  return m.description;
}

async function argsFor(m: ManifestMethod, input: Record<string, unknown>): Promise<unknown[]> {
  const args: unknown[] = [];
  let filename: string | undefined;
  for (const p of m.params) {
    if (p.role === "file") {
      const upload = await readUpload(input["filePath"]);
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
  const name = toolName(m.name);
  const inputSchema = inputSchemaOf(m);
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
      const args = await argsFor(m, input); // argument and file errors surface BEFORE any Garmin call
      const garmin = await deps.session.get();
      const fn = (garmin as unknown as Record<string, unknown>)[m.name];
      if (typeof fn !== "function") throw new Error(`garminconnect-js has no method ${m.name}`);
      const result: unknown = await (fn as (...a: unknown[]) => Promise<unknown>).apply(garmin, args);
      if (m.io === "binary-out") {
        return jsonResult(await saveDownload(deps.config.downloadDir, downloadName(m, input), result as Uint8Array));
      }
      return jsonResult(result);
    },
  };
}

export const methodTools: ToolFactory = (deps) => {
  const known = new Set(GARMIN_METHODS.map((m) => m.category));
  if (deps.config.groups) {
    const unknown = [...deps.config.groups].filter((g) => !known.has(g));
    if (unknown.length > 0) {
      throw new Error(`Unknown GARMIN_MCP_GROUPS value(s): ${unknown.join(", ")}. Valid: ${[...known].sort().join(", ")}`);
    }
  }
  return GARMIN_METHODS.filter((m) => !Object.hasOwn(EXCLUDED, m.name))
    .filter((m) => !Object.hasOwn(OPT_IN, m.name) || deps.config[OPT_IN[m.name]!])
    .filter((m) => deps.config.groups === null || deps.config.groups.has(m.category))
    .map((m) => toolFor(m, deps));
};
