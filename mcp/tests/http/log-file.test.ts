import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// eslint-disable-next-line no-restricted-imports
import { createLogger, logFileName } from "../../src/http/log-file.js";

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "mcp-logs-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("createLogger", () => {
  it("names files by UTC month", () => {
    expect(logFileName(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10.jsonl");
    expect(logFileName(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11.jsonl");
  });

  it("writes each line to stdout and appends it to the month's file, creating the directory", () => {
    const dir = join(tempDir(), "logs");
    const out: string[] = [];
    let at = new Date("2026-10-25T08:00:00Z");
    const log = createLogger(dir, { now: () => at, write: (t) => out.push(t) });
    log({ rpc: "initialize", status: 200 });
    log({ rpc: "tools/list", status: 200 });
    at = new Date("2026-11-01T00:00:01Z");
    log({ msg: "listening" });

    expect(out).toHaveLength(3);
    expect(JSON.parse(out[0]!)).toEqual({ t: "2026-10-25T08:00:00.000Z", rpc: "initialize", status: 200 });
    expect(readdirSync(dir).sort()).toEqual(["2026-10.jsonl", "2026-11.jsonl"]);
    expect(readFileSync(join(dir, "2026-10.jsonl"), "utf8")).toBe(out[0]! + out[1]!);
    expect(readFileSync(join(dir, "2026-11.jsonl"), "utf8")).toBe(out[2]);
  });

  it("keeps what an earlier process wrote", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "2026-10.jsonl"), '{"msg":"before restart"}\n');
    createLogger(dir, { now: () => new Date("2026-10-25T08:00:00Z"), write: () => {} })({ msg: "after" });
    expect(readFileSync(join(dir, "2026-10.jsonl"), "utf8").split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("survives an unwritable directory, warning once and still writing stdout", () => {
    const blocker = join(tempDir(), "file");
    writeFileSync(blocker, "");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out: string[] = [];
    const log = createLogger(join(blocker, "logs"), { write: (t) => out.push(t) });
    log({ a: 1 });
    log({ a: 2 });
    expect(out).toHaveLength(2);
    expect(err).toHaveBeenCalledTimes(1);
  });
});
