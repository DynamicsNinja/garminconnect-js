import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports
import type { GrantOwner } from "../../src/http/grants.js";
// eslint-disable-next-line no-restricted-imports
import { ToolUsage } from "../../src/http/tool-usage.js";

const DAY = 20_000 * 86_400; // 2024-10-04
const iso = (s: number) => new Date(s * 1000).toISOString();
const call = (at: number, user: string, tool = "get_sleep_data") => ({ t: iso(at), grant: "g0000000", user, rpc: "tools/call", tool, status: 200 });
const list = (at: number, user: string) => ({ t: iso(at), grant: "g0000000", user, rpc: "tools/list", status: 200 });

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tool-usage-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (file: string, lines: object[]) => appendFileSync(join(dir, file), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
const usage = (owners: GrantOwner[] = []) => new ToolUsage(dir, () => owners, 90);

describe("ToolUsage", () => {
  it("counts people who called a tool, not those who only connected or listed tools", () => {
    write("2024-10.jsonl", [list(DAY, "aaaaaaaa"), call(DAY + 10, "bbbbbbbb"), call(DAY + 20, "bbbbbbbb", "get_activity"), { t: iso(DAY + 30), msg: "listening" }]);
    const u = usage();
    u.refresh(DAY + 60);
    expect(u.peopleSince(DAY - 86_400)).toBe(1);
    expect(u.peopleOn("2024-10-04")).toBe(1);
  });

  it("keeps rolling windows from each person's latest tool call", () => {
    write("2024-09.jsonl", [call(DAY - 20 * 86_400, "old00000")]);
    write("2024-10.jsonl", [call(DAY - 3 * 86_400, "week0000"), call(DAY - 3600, "today000")]);
    const u = usage();
    u.refresh(DAY);
    expect([u.peopleSince(DAY - 86_400), u.peopleSince(DAY - 7 * 86_400), u.peopleSince(DAY - 30 * 86_400)]).toEqual([1, 2, 3]);
  });

  it("backfills every day the logs cover, with 0 on quiet days and null before the first line", () => {
    write("2024-10.jsonl", [list(DAY - 2 * 86_400, "aaaaaaaa"), call(DAY, "aaaaaaaa"), call(DAY + 5, "bbbbbbbb")]);
    const u = usage();
    u.refresh(DAY + 60);
    expect(["2024-10-01", "2024-10-02", "2024-10-03", "2024-10-04"].map((d) => u.peopleOn(d))).toEqual([null, 0, 0, 2]);
  });

  it("reads only what was appended since the last refresh, and waits for a half-written line", () => {
    write("2024-10.jsonl", [call(DAY, "aaaaaaaa")]);
    const u = usage();
    u.refresh(DAY + 60);
    appendFileSync(join(dir, "2024-10.jsonl"), JSON.stringify(call(DAY + 70, "bbbbbbbb")).slice(0, 20));
    u.refresh(DAY + 120);
    expect(u.peopleOn("2024-10-04")).toBe(1);
    appendFileSync(join(dir, "2024-10.jsonl"), `${JSON.stringify(call(DAY + 70, "bbbbbbbb")).slice(20)}\n`);
    u.refresh(DAY + 180);
    expect(u.peopleOn("2024-10-04")).toBe(2);
    u.refresh(DAY + 240); // nothing new: nothing counted twice
    expect(u.peopleSince(0)).toBe(2);
  });

  it("finds the person for lines logged before the person prefix existed, else counts the connection", () => {
    const owners: GrantOwner[] = [
      { grantId: "grantA00xyz", userHash: "personA0hash", clientName: "Claude" },
      { grantId: "grantB00xyz", userHash: "personA0hash", clientName: "Claude Desktop" },
    ];
    write("2024-10.jsonl", [
      { t: iso(DAY), grant: "grantA00", rpc: "tools/call", tool: "x" },
      { t: iso(DAY + 1), grant: "grantB00", rpc: "tools/call", tool: "x" },
      { t: iso(DAY + 2), grant: "gone0000", rpc: "tools/call", tool: "x" },
    ]);
    const u = usage(owners);
    u.refresh(DAY + 60);
    expect(u.peopleOn("2024-10-04")).toBe(2); // personA0 on two connections, plus one purged connection
  });

  it("skips damaged lines, unrelated files and months older than the window", () => {
    write("2024-05.jsonl", [call(DAY - 140 * 86_400, "ancient0")]);
    write("notes.jsonl", [call(DAY, "notalog0")]);
    writeFileSync(join(dir, "2024-10.jsonl"), `not json\n${JSON.stringify(call(DAY, "aaaaaaaa"))}\n`);
    const u = usage();
    u.refresh(DAY + 60);
    expect(u.peopleSince(0)).toBe(1);
    expect(u.peopleOn("2024-05-17")).toBeNull();
  });

  it("is empty, not an error, when the log directory does not exist", () => {
    const u = new ToolUsage(join(dir, "missing"), () => [], 90);
    u.refresh(DAY);
    expect(u.peopleSince(0)).toBe(0);
    expect(u.peopleOn("2024-10-04")).toBeNull();
  });
});
