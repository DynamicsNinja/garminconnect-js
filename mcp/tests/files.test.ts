import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expandHome, readUpload, saveDownload, sniffExtension } from "../src/files.js";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("expandHome", () => {
  it("expands a leading ~", () => {
    expect(expandHome("~/Downloads/run.gpx")).toBe(path.join(os.homedir(), "Downloads", "run.gpx"));
    expect(expandHome("~")).toBe(os.homedir());
    expect(expandHome("/abs/x.gpx")).toBe("/abs/x.gpx");
  });
});

describe("readUpload", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gc-up-"));
  const gpx = path.join(dir, "run.gpx");
  writeFileSync(gpx, "<gpx></gpx>");

  it("reads an absolute path to an allowed file", async () => {
    const { blob, filename } = await readUpload(gpx);
    expect(filename).toBe("run.gpx");
    expect(await blob.text()).toBe("<gpx></gpx>");
  });
  it("rejects a relative path", async () => {
    await expect(readUpload("run.gpx")).rejects.toThrow("filePath must be an absolute path");
  });
  it("rejects another extension", async () => {
    await expect(readUpload(path.join(dir, "notes.txt"))).rejects.toThrow('Only .fit, .gpx and .tcx files can be uploaded; got ".txt"');
  });
  it("rejects a missing file", async () => {
    await expect(readUpload(path.join(dir, "missing.fit"))).rejects.toThrow(/Cannot read .*missing\.fit/);
  });
  it("says so when the path is a directory", async () => {
    const folder = path.join(dir, "rides.gpx");
    mkdirSync(folder);
    await expect(readUpload(folder)).rejects.toThrow(/rides\.gpx is a folder, not a file/);
  });
});

describe("sniffExtension", () => {
  it("recognises the formats Garmin returns", () => {
    const fit = new Uint8Array(14);
    fit.set(bytes(".FIT"), 8);
    expect(sniffExtension(fit)).toBe("fit");
    expect(sniffExtension(bytes("PK\u0003\u0004rest"))).toBe("zip");
    expect(sniffExtension(bytes('<?xml version="1.0"?>\n<gpx version="1.1">'))).toBe("gpx");
    expect(sniffExtension(bytes("<TrainingCenterDatabase>"))).toBe("tcx");
    expect(sniffExtension(bytes("<kml>"))).toBe("kml");
    expect(sniffExtension(bytes('{"a":1}'))).toBe("json");
    expect(sniffExtension(bytes("a,b\n1,2\n"))).toBe("csv");
    expect(sniffExtension(new Uint8Array([1, 2, 3]))).toBe("bin");
  });
});

describe("saveDownload", () => {
  it("creates the directory and writes the file", async () => {
    const dir = path.join(mkdtempSync(path.join(os.tmpdir(), "gc-dl-")), "nested", "deeper");
    const saved = await saveDownload(dir, "download_workout-42", bytes('{"x":1}'));
    expect(saved).toEqual({ path: path.join(dir, "download_workout-42.json"), bytes: 7 });
    expect(readFileSync(saved.path, "utf8")).toBe('{"x":1}');
  });

  it("never overwrites an earlier download of the same thing", async () => {
    // Downloading activity 42 as GPX, then again after an edit, must keep both copies.
    const dir = mkdtempSync(path.join(os.tmpdir(), "gc-dl-"));
    const first = await saveDownload(dir, "download_workout-42", bytes('{"v":1}'));
    const second = await saveDownload(dir, "download_workout-42", bytes('{"v":2}'));
    const third = await saveDownload(dir, "download_workout-42", bytes('{"v":3}'));
    expect(second.path).toBe(path.join(dir, "download_workout-42-2.json"));
    expect(third.path).toBe(path.join(dir, "download_workout-42-3.json"));
    expect(readFileSync(first.path, "utf8")).toBe('{"v":1}');
    expect(readFileSync(second.path, "utf8")).toBe('{"v":2}');
  });
});
