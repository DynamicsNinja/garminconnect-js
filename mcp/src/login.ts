import { createInterface } from "node:readline/promises";
import type { LoginResult, MfaState } from "garminconnect-js";

export interface LoginClient {
  login(email: string, password: string): Promise<LoginResult>;
  resumeLogin(mfaState: MfaState, code: string): Promise<void>;
}

export interface LoginIo {
  ask(question: string): Promise<string>;
  askHidden(question: string): Promise<string>;
  log(line: string): void;
}

/** Sign in once. The client's token store saves the session; nothing is printed to stdout. */
export async function login(io: LoginIo, client: LoginClient, env: Record<string, string | undefined> = process.env): Promise<void> {
  const email = env["GARMIN_EMAIL"]?.trim() || (await io.ask("Garmin email: ")).trim();
  const password = env["GARMIN_PASSWORD"] || (await io.askHidden("Garmin password: "));
  if (!email || !password) throw new Error("Email and password are required.");
  const result = await client.login(email, password);
  if (result.state === "mfa_required") {
    const code = (await io.ask("MFA code from Garmin: ")).trim();
    if (!code) throw new Error("No MFA code entered.");
    await client.resumeLogin(result.mfaState, code);
  }
}

/** Prompts on stderr, so stdout stays clean even here. */
export function terminalIo(): LoginIo {
  return {
    async ask(question) {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
    askHidden(question) {
      return new Promise((resolve, reject) => {
        const stdin = process.stdin;
        process.stderr.write(question);
        stdin.setRawMode?.(true);
        stdin.resume();
        stdin.setEncoding("utf8");
        let value = "";
        const done = (error?: Error) => {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stderr.write("\n");
          if (error) reject(error);
          else resolve(value);
        };
        const onData = (chunk: string) => {
          for (const ch of chunk) {
            if (ch === "\r" || ch === "\n") return done();
            if (ch === "\u0003") return done(new Error("Cancelled."));
            if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
            else value += ch;
          }
        };
        stdin.on("data", onData);
      });
    },
    log: (line) => console.error(line),
  };
}
