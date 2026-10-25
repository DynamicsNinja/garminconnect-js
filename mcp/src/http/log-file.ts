/**
 * The hosted server's log: each line goes to stdout (what Dokploy shows) AND is appended to
 * `<dir>/YYYY-MM.jsonl`, one file per UTC month, on the data volume, so the history survives
 * restarts and redeploys. Nothing here ever deletes a file. A failed append is reported once on
 * stderr and never takes the server down; stdout keeps working either way.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type LogLine = Record<string, unknown>;

export function logFileName(at: Date): string {
  return `${at.toISOString().slice(0, 7)}.jsonl`;
}

export function createLogger(dir: string, options: { now?: () => Date; write?: (text: string) => void } = {}): (line: LogLine) => void {
  const now = options.now ?? (() => new Date());
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  let ready = false;
  let warned = false;
  return (line) => {
    const at = now();
    const text = `${JSON.stringify({ t: at.toISOString(), ...line })}\n`;
    write(text);
    try {
      if (!ready) {
        mkdirSync(dir, { recursive: true });
        ready = true;
      }
      appendFileSync(join(dir, logFileName(at)), text);
      warned = false;
    } catch (error) {
      if (!warned) console.error(`log file append failed in ${dir}: ${error instanceof Error ? error.message : String(error)}`);
      warned = true;
    }
  };
}
