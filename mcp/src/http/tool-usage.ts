/**
 * Who has actually used the connector, read from the log files: a person counts once one of their
 * requests was a `tools/call`. Connecting, listing the tools or refreshing a token does not count,
 * so a client that keeps the connector switched on while its user talks about something else, or
 * a directory crawler (Glama lists the tools every ~25 minutes), is not "active". Because the
 * month files are kept for good, every day they cover is counted, including days logged before
 * this existed.
 *
 * Reading is incremental: each refresh reads only the bytes appended since the last one, and only
 * the month files the trend can show, so the stats page never rescans the whole history.
 */
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";
import { utcDay, type GrantOwner } from "./grants.js";

const MONTH_FILE = /^\d{4}-\d{2}\.jsonl$/;

export class ToolUsage {
  readonly #dir: string;
  readonly #owners: () => GrantOwner[];
  readonly #since: number;
  readonly #offsets = new Map<string, number>();
  /** Person prefix (or `grant:<prefix>` when a line names no person) → their latest tool call, in seconds. */
  readonly #last = new Map<string, number>();
  /** UTC day → the people who called a tool that day. */
  readonly #days = new Map<string, Set<string>>();
  #firstDay: string | null = null;

  /** `sinceDays`: how far back the first refresh reads; older month files are skipped. */
  constructor(dir: string, owners: () => GrantOwner[], sinceDays: number) {
    this.#dir = dir;
    this.#owners = owners;
    this.#since = sinceDays * 86_400;
  }

  refresh(now: number): void {
    if (!existsSync(this.#dir)) return;
    const oldest = `${utcDay(now - this.#since).slice(0, 7)}.jsonl`;
    const files = readdirSync(this.#dir).filter((f) => MONTH_FILE.test(f) && f >= oldest).sort();
    let people: Map<string, string> | null = null;
    // Lines from before the person prefix was logged: take it from the grant still on record.
    const personOf = (line: Record<string, unknown>): string | null => {
      if (typeof line["user"] === "string") return line["user"];
      if (typeof line["grant"] !== "string") return null;
      people ??= new Map(this.#owners().map((o) => [o.grantId.slice(0, 8), o.userHash.slice(0, 8)]));
      return people.get(line["grant"]) ?? `grant:${line["grant"]}`;
    };
    for (const file of files) {
      for (const line of this.#readNew(join(this.#dir, file), file)) {
        const t = typeof line["t"] === "string" ? Date.parse(line["t"]) : NaN;
        if (Number.isNaN(t)) continue;
        const at = Math.floor(t / 1000);
        const day = utcDay(at);
        if (this.#firstDay === null || day < this.#firstDay) this.#firstDay = day;
        if (line["rpc"] !== "tools/call") continue;
        const person = personOf(line);
        if (person === null) continue;
        if ((this.#last.get(person) ?? -Infinity) < at) this.#last.set(person, at);
        let set = this.#days.get(day);
        if (!set) this.#days.set(day, (set = new Set()));
        set.add(person);
      }
    }
  }

  /** People who called a tool since `since` (seconds). */
  peopleSince(since: number): number {
    let n = 0;
    for (const at of this.#last.values()) if (at >= since) n++;
    return n;
  }

  /** People who called a tool on a UTC day; `null` for a day before the earliest log line read. */
  peopleOn(day: string): number | null {
    if (this.#firstDay === null || day < this.#firstDay) return null;
    return this.#days.get(day)?.size ?? 0;
  }

  /** The complete lines appended to `path` since the last read; a line still being written waits for the next one. */
  #readNew(path: string, file: string): Record<string, unknown>[] {
    const fd = openSync(path, "r");
    try {
      const from = this.#offsets.get(file) ?? 0;
      const size = fstatSync(fd).size;
      if (size <= from) return [];
      const buf = Buffer.alloc(size - from);
      const read = readSync(fd, buf, 0, buf.length, from);
      const end = buf.lastIndexOf(0x0a, read - 1);
      if (end < 0) return [];
      this.#offsets.set(file, from + end + 1);
      const lines: Record<string, unknown>[] = [];
      for (const text of buf.subarray(0, end).toString("utf8").split("\n")) {
        try {
          const parsed: unknown = JSON.parse(text);
          if (typeof parsed === "object" && parsed !== null) lines.push(parsed as Record<string, unknown>);
        } catch {
          // a damaged line is skipped, not fatal
        }
      }
      return lines;
    } finally {
      closeSync(fd);
    }
  }
}
