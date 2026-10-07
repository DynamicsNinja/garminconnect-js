import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { jsonResult } from "./results.js";

export const UPLOAD_EXTENSIONS = [".fit", ".gpx", ".tcx"] as const;

/** `~/x` means the home directory, as it does in any shell the user would copy a path from. */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export async function readUpload(filePath: unknown): Promise<{ blob: Blob; filename: string }> {
  const p = typeof filePath === "string" ? expandHome(filePath.trim()) : "";
  if (!p || !path.isAbsolute(p)) {
    throw new Error("filePath must be an absolute path to a local file, e.g. /Users/me/Downloads/run.gpx");
  }
  const ext = path.extname(p).toLowerCase();
  if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(`Only .fit, .gpx and .tcx files can be uploaded; got "${ext || "no extension"}"`);
  }
  let data: Buffer;
  try {
    data = await readFile(p);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EISDIR") throw new Error(`${p} is a folder, not a file`);
    throw new Error(`Cannot read ${p}: the file does not exist or is not readable`);
  }
  return { blob: new Blob([data]), filename: path.basename(p) };
}

/** A file extension from the bytes themselves, so the server needs no per-endpoint knowledge. */
export function sniffExtension(bytes: Uint8Array): string {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "zip";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(8, 12)) === ".FIT") return "fit";
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart();
  if (head.startsWith("<")) {
    if (/<gpx[\s>]/.test(head)) return "gpx";
    if (/<TrainingCenterDatabase[\s>]/.test(head)) return "tcx";
    if (/<kml[\s>]/.test(head)) return "kml";
    return "xml";
  }
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  if (/^[^\n]*,[^\n]*\n/.test(head)) return "csv";
  return "bin";
}

/**
 * Writes the bytes under `dir`, never replacing an earlier file: a second download of the same
 * thing becomes `name-2.ext`, then `name-3.ext`. The exclusive-create flag makes the check and the
 * write one step, so two downloads racing for a name cannot both claim it.
 */
export async function saveDownload(dir: string, baseName: string, bytes: Uint8Array): Promise<{ path: string; bytes: number }> {
  await mkdir(dir, { recursive: true });
  const ext = sniffExtension(bytes);
  for (let n = 1; ; n++) {
    const target = path.join(dir, `${baseName}${n === 1 ? "" : `-${n}`}.${ext}`);
    try {
      await writeFile(target, bytes, { flag: "wx" });
      return { path: target, bytes: bytes.length };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

/**
 * How upload tools get their file and download tools hand theirs back. The stdio server reads and
 * writes the user's disk (`localFiles`); the hosted server cannot, and moves the bytes inside the
 * MCP messages instead (`http/inline-files.ts`).
 */
export interface FilesStrategy {
  /** Input-schema properties that stand in for a method's `file`/`filename` parameters. */
  uploadSchema(): { properties: Record<string, object>; required: string[] };
  readUpload(input: Record<string, unknown>): Promise<{ blob: Blob; filename: string }>;
  deliverDownload(baseName: string, bytes: Uint8Array): Promise<CallToolResult>;
}

export function localFiles(downloadDir: string): FilesStrategy {
  return {
    uploadSchema: () => ({
      properties: {
        filePath: { type: "string", description: "Absolute path to a local .fit, .gpx or .tcx file (~ is expanded)" },
      },
      required: ["filePath"],
    }),
    readUpload: (input) => readUpload(input["filePath"]),
    deliverDownload: async (baseName, bytes) => jsonResult(await saveDownload(downloadDir, baseName, bytes)),
  };
}
