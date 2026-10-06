/**
 * A machine-readable description of every `Garmin` method, for tools generated FROM this library
 * (the `garminconnect-mcp` server is one): parameters as JSON Schema, a safety class, and whether
 * the method takes or returns a file.
 *
 * Published as the `garminconnect-js/manifest` subpath. The data is GENERATED from `src/garmin.ts`
 * by `scripts/generate-manifest.ts`, and `tests/manifest.test.ts` fails if it is stale, so a
 * signature change cannot ship without the manifest following it.
 *
 * Return types are intentionally not described: they are wide, mostly index-signature types.
 */
export type JsonSchema = { [key: string]: unknown };

/** `read` changes nothing; `destructive` deletes or overwrites; `write` is everything else. */
export type Safety = "read" | "write" | "destructive";

export interface ManifestParam {
  name: string;
  optional: boolean;
  schema: JsonSchema;
  /** `file` is a `Blob` argument; `filename` is the name that travels with it. */
  role?: "file" | "filename";
  /** `"date"`: a bare `Date` param (schema `format: "date-time"`) — the caller must convert a JSON string to a real `Date` before calling the method. */
  coerce?: "date";
}

export interface ManifestMethod {
  name: string;
  category: string;
  description: string;
  params: ManifestParam[];
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
