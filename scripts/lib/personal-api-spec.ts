/**
 * Loads Garmin's Personal API OpenAPI spec, for `smoke-personal-api-real.ts` and
 * `generate-personal-api-types.ts`.
 *
 * The Swagger page links no spec file: the spec is inlined in the page's JS bundle as
 * `JSON.parse('{"openapi":…}')`. It is fetched at run time rather than committed, because the
 * developer site's terms for redistributing it are unknown.
 */
import { readFileSync } from "node:fs";

export const SWAGGER_PAGE = "https://developer.garmin.com/gc-developer-program/personal/swagger-docs/";

export interface OpenApiSchema {
  $ref?: string;
  type?: string;
  format?: string;
  enum?: unknown[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  additionalProperties?: OpenApiSchema | boolean;
  allOf?: OpenApiSchema[];
}

export interface OpenApiSpec {
  info: { title: string; version: string };
  paths: Record<
    string,
    { get: { responses: Record<string, { content?: Record<string, { schema: OpenApiSchema }> }> } }
  >;
  components: { schemas: Record<string, OpenApiSchema> };
}

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

/** The spec from a local file when `path` is given, else fetched from developer.garmin.com. */
export async function loadPersonalApiSpec(path?: string): Promise<OpenApiSpec> {
  return JSON.parse(path ? readFileSync(path, "utf8") : await fetchSpecText()) as OpenApiSpec;
}

/** The schema of a path's 200 JSON response, if the spec declares one. */
export function responseSchema(spec: OpenApiSpec, path: string): OpenApiSchema | undefined {
  return spec.paths[path]?.get.responses["200"]?.content?.["application/json"]?.schema;
}
