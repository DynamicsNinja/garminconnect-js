import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
  } catch {
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

export async function saveDownload(dir: string, baseName: string, bytes: Uint8Array): Promise<{ path: string; bytes: number }> {
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, `${baseName}.${sniffExtension(bytes)}`);
  await writeFile(target, bytes);
  return { path: target, bytes: bytes.length };
}
