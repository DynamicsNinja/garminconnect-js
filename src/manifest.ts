/**
 * A machine-readable description of every `Garmin` method, for tools generated FROM this library
 * (the `garminconnect-mcp` server is one): parameters as JSON Schema, a safety class, and whether
 * the method takes or returns a file.
 *
 * Exports {@link GARMIN_METHODS} (one {@link ManifestMethod} per method) and the types that
 * describe it: `ManifestMethod`, `ManifestParam`, `Safety` and `JsonSchema`.
 *
 * Published as the `garminconnect-js/manifest` subpath. The data is GENERATED from `src/garmin.ts`
 * by `scripts/generate-manifest.ts`, and `tests/manifest.test.ts` fails if it is stale, so a
 * signature change cannot ship without the manifest following it.
 *
 * Return types are intentionally not described: they are wide, mostly index-signature types.
 *
 * @module
 */

/** A JSON Schema object describing one parameter's accepted values. */
export type JsonSchema = { [key: string]: unknown };

/** `read` changes nothing; `destructive` deletes or overwrites; `write` is everything else. */
export type Safety = "read" | "write" | "destructive";

/** One parameter of a `ManifestMethod`. */
export interface ManifestParam {
  /** The parameter's name in the method signature. */
  name: string;
  /** Whether the parameter may be omitted. */
  optional: boolean;
  /** The values it accepts, as JSON Schema. */
  schema: JsonSchema;
  /** `file` is a `Blob` argument; `filename` is the name that travels with it. */
  role?: "file" | "filename";
  /** `"date"`: a bare `Date` param (schema `format: "date-time"`) — the caller must convert a JSON string to a real `Date` before calling the method. */
  coerce?: "date";
}

/** One `Garmin` method, described for a tool generator. */
export interface ManifestMethod {
  /** The method's name on `Garmin`. */
  name: string;
  /** The API-docs category it belongs to, as a slug, e.g. `"wellness"`. */
  category: string;
  /** One paragraph on what the method does, written for a tool description. */
  description: string;
  /** Its parameters, in call order. */
  params: ManifestParam[];
  /** Whether calling it reads, writes, or deletes/overwrites data. */
  safety: Safety;
  /** `binary-in` takes a file (a `file` param); `binary-out` resolves to a `Buffer`. */
  io: "json" | "binary-in" | "binary-out";
  /**
   * Present and `true` only for methods that need a Garmin Connect+ subscription (see
   * `CONNECT_PLUS_METHODS`); without it they throw `GarminConnectPlusRequiredError`.
   */
  requiresConnectPlus?: true;
}

export { GARMIN_METHODS } from "./generated/manifest.js";
