import { describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- internal MCP module, not root src/
import { inlineFiles, MAX_DOWNLOAD_BYTES, MAX_UPLOAD_BYTES } from "../../src/http/inline-files.js";

const GPX = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Run</name></trk></gpx>`;
const FIT = (() => {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode(".FIT"), 8);
  return b;
})();

describe("inlineFiles uploads", () => {
  it("asks for filename + content + encoding instead of a path", () => {
    const s = inlineFiles.uploadSchema();
    expect(Object.keys(s.properties)).toEqual(["filename", "content", "encoding"]);
    expect(s.required).toEqual(["filename", "content"]);
  });

  it("reads utf8 text", async () => {
    const { blob, filename } = await inlineFiles.readUpload({ filename: "run.gpx", content: GPX });
    expect(filename).toBe("run.gpx");
    expect(await blob.text()).toBe(GPX);
  });

  it("reads base64 binary", async () => {
    const { blob } = await inlineFiles.readUpload({ filename: "ride.FIT", content: Buffer.from(FIT).toString("base64"), encoding: "base64" });
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(FIT);
  });

  it("keeps only the base name of a path-like filename", async () => {
    expect((await inlineFiles.readUpload({ filename: "../../etc/run.gpx", content: GPX })).filename).toBe("run.gpx");
  });

  it("rejects other extensions, empty content and oversize files", async () => {
    await expect(inlineFiles.readUpload({ filename: "notes.txt", content: "x" })).rejects.toThrow(/\.fit, \.gpx and \.tcx/);
    await expect(inlineFiles.readUpload({ filename: "noext", content: "x" })).rejects.toThrow(/\.fit, \.gpx and \.tcx/);
    await expect(inlineFiles.readUpload({ filename: "run.gpx", content: "" })).rejects.toThrow(/empty/);
    await expect(inlineFiles.readUpload({ filename: "run.gpx", content: "a".repeat(MAX_UPLOAD_BYTES + 1) })).rejects.toThrow(/limit/);
  });
});

describe("inlineFiles downloads", () => {
  it("returns text formats as a text resource", async () => {
    const r = await inlineFiles.deliverDownload("download_course_gpx-5", new TextEncoder().encode(GPX));
    expect(r.content[0]).toEqual({ type: "text", text: `download_course_gpx-5.gpx (${GPX.length} bytes)` });
    expect(r.content[1]).toEqual({
      type: "resource",
      resource: { uri: "garmin://download/download_course_gpx-5.gpx", mimeType: "application/gpx+xml", text: GPX },
    });
  });

  it("returns binary formats as a base64 blob resource", async () => {
    const r = await inlineFiles.deliverDownload("download_activity-7", FIT);
    expect(r.content[1]).toEqual({
      type: "resource",
      resource: { uri: "garmin://download/download_activity-7.fit", mimeType: "application/vnd.ant.fit", blob: Buffer.from(FIT).toString("base64") },
    });
  });

  it("refuses files over the download limit", async () => {
    await expect(inlineFiles.deliverDownload("big", new Uint8Array(MAX_DOWNLOAD_BYTES + 1))).rejects.toThrow(/limit/);
  });
});
