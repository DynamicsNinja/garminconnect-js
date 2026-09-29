/**
 * Checks a tool call's arguments against the tool's own input schema, before anything reaches
 * Garmin.
 *
 * The low-level MCP `Server` passes arguments through unchecked, so without this a wrong type went
 * straight into the library (where some calls fail late and unclearly) and a misspelt optional
 * argument was silently ignored. Messages are written for Claude to act on:
 * `Invalid arguments for get_activities: start must be number`.
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

// `strict: false` and no format validation: the manifest's schemas use `format: "date"` /
// `"date-time"` as documentation, and dates are checked (or coerced) by the library and argsFor.
const ajv = new Ajv2020({ strict: false, validateFormats: false });

/** `/options/name` -> `options.name`, `/days/0` -> `days[0]`. */
function pathOf(instancePath: string): string {
  return instancePath
    .split("/")
    .filter(Boolean)
    .map((part, i) => (/^\d+$/.test(part) ? `[${part}]` : i === 0 ? part : `.${part}`))
    .join("");
}

function describe(error: ErrorObject): string {
  const at = pathOf(error.instancePath);
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case "additionalProperties":
      return at === ""
        ? `unknown argument "${String(params["additionalProperty"])}"`
        : `${at}: unknown key "${String(params["additionalProperty"])}"`;
    case "required":
      return at === ""
        ? `missing required argument "${String(params["missingProperty"])}"`
        : `${at}: missing "${String(params["missingProperty"])}"`;
    case "enum":
      return `${at} must be one of ${(params["allowedValues"] as unknown[]).map(String).join(", ")}`;
    case "type": {
      const type = params["type"];
      return `${at} must be ${Array.isArray(type) ? type.join(" or ") : String(type)}`;
    }
    default:
      return `${at || "arguments"} ${error.message ?? "is invalid"}`;
  }
}

/** Compiles once; the returned function throws an Error naming the tool and the first problem. */
export function argumentValidator(toolName: string, schema: object): (input: Record<string, unknown>) => void {
  let validate: ValidateFunction | undefined;
  return (input) => {
    validate ??= ajv.compile(schema);
    if (validate(input)) return;
    const first = validate.errors?.[0];
    throw new Error(`Invalid arguments for ${toolName}: ${first ? describe(first) : "rejected by the input schema"}`);
  };
}
