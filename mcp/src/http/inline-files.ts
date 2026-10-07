import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { sniffExtension, UPLOAD_EXTENSIONS, type FilesStrategy } from "../files.js";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;

const MIME: Record<string, string> = {
  gpx: "application/gpx+xml",
  tcx: "application/vnd.garmin.tcx+xml",
  kml: "application/vnd.google-earth.kml+xml",
  csv: "text/csv",
  xml: "application/xml",
  json: "application/json",
  fit: "application/vnd.ant.fit",
  zip: "application/zip",
  bin: "application/octet-stream",
};
const TEXT = new Set(["gpx", "tcx", "kml", "csv", "xml", "json"]);
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** The hosted server cannot see the user's disk: files travel inside the MCP messages. */
export const inlineFiles: FilesStrategy = {
  uploadSchema: () => ({
    properties: {
      filename: { type: "string", description: "File name ending in .fit, .gpx or .tcx, e.g. morning-run.gpx" },
      content: { type: "string", description: "The file's contents: plain text for .gpx/.tcx, base64 for .fit" },
      encoding: { type: "string", enum: ["utf8", "base64"], description: "How content is encoded. Default utf8; use base64 for .fit" },
    },
    required: ["filename", "content"],
  }),

  async readUpload(input) {
    const raw = typeof input["filename"] === "string" ? input["filename"].trim() : "";
    const filename = raw.split(/[\\/]/).pop() ?? "";
    const dot = filename.lastIndexOf(".");
    const ext = dot > 0 ? filename.slice(dot).toLowerCase() : "";
    if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new Error(`Only .fit, .gpx and .tcx files can be uploaded; got "${filename || "no filename"}"`);
    }
    const content = typeof input["content"] === "string" ? input["content"] : "";
    if (!content) throw new Error("content is empty");
    const bytes = Buffer.from(content, input["encoding"] === "base64" ? "base64" : "utf8");
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw new Error(`The file is ${mb(bytes.length)}; the limit is ${mb(MAX_UPLOAD_BYTES)}`);
    }
    return { blob: new Blob([bytes]), filename };
  },

  async deliverDownload(baseName, bytes): Promise<CallToolResult> {
    if (bytes.length > MAX_DOWNLOAD_BYTES) {
      throw new Error(`The file is ${mb(bytes.length)}, over the ${mb(MAX_DOWNLOAD_BYTES)} limit for returning it in a chat`);
    }
    const ext = sniffExtension(bytes);
    const name = `${baseName}.${ext}`;
    const uri = `garmin://download/${encodeURIComponent(name)}`;
    const mimeType = MIME[ext] ?? "application/octet-stream";
    const resource = TEXT.has(ext)
      ? { uri, mimeType, text: Buffer.from(bytes).toString("utf8") }
      : { uri, mimeType, blob: Buffer.from(bytes).toString("base64") };
    return { content: [{ type: "text", text: `${name} (${bytes.length} bytes)` }, { type: "resource", resource }] };
  },
};
