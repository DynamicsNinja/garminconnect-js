import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileTokenStore, MemoryTokenStore } from "../../src/auth/token-store.js";
import type { Tokens } from "../../src/auth/tokens.js";

const tokens: Tokens = {
  oauth1: {
    oauth_token: "o1",
    oauth_token_secret: "s1",
    mfa_token: "m1",
    domain: "garmin.com",
  },
  oauth2: {
    scope: "CONNECT_READ",
    jti: "j",
    token_type: "Bearer",
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    expires_at: 1_800_000_000,
    refresh_token_expires_in: 7200,
    refresh_token_expires_at: 1_800_003_600,
  },
};

describe("MemoryTokenStore", () => {
  it("returns null before anything is saved", async () => {
    await expect(new MemoryTokenStore().load()).resolves.toBeNull();
  });

  it("round-trips and clears", async () => {
    const store = new MemoryTokenStore();
    await store.save(tokens);
    await expect(store.load()).resolves.toEqual(tokens);
    await store.clear();
    await expect(store.load()).resolves.toBeNull();
  });
});

describe("FileTokenStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "gcjs-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("returns null when the directory has no tokens", async () => {
    await expect(new FileTokenStore(dir).load()).resolves.toBeNull();
  });

  it("round-trips through disk", async () => {
    const store = new FileTokenStore(dir);
    await store.save(tokens);
    await expect(store.load()).resolves.toEqual(tokens);
  });

  it("writes garth's two-file layout", async () => {
    await new FileTokenStore(dir).save(tokens);
    const o1 = JSON.parse(await readFile(join(dir, "oauth1_token.json"), "utf8"));
    const o2 = JSON.parse(await readFile(join(dir, "oauth2_token.json"), "utf8"));
    expect(o1.oauth_token).toBe("o1");
    expect(o1.oauth_token_secret).toBe("s1");
    expect(o2.access_token).toBe("at");
    expect(o2.expires_at).toBe(1_800_000_000);
  });

  it("loads tokens written by Python garth", async () => {
    await writeFile(
      join(dir, "oauth1_token.json"),
      JSON.stringify({
        oauth_token: "py1",
        oauth_token_secret: "pys1",
        mfa_token: null,
        mfa_expiration_timestamp: null,
        domain: null,
      }),
    );
    await writeFile(
      join(dir, "oauth2_token.json"),
      JSON.stringify({ ...tokens.oauth2, access_token: "pyat" }),
    );
    const loaded = await new FileTokenStore(dir).load();
    expect(loaded?.oauth1.oauth_token).toBe("py1");
    expect(loaded?.oauth1.mfa_token).toBeUndefined();
    expect(loaded?.oauth1.mfa_expiration_timestamp).toBeUndefined();
    expect(loaded?.oauth1.domain).toBeUndefined();
    expect(loaded?.oauth2.access_token).toBe("pyat");
  });

  it("creates the directory when missing", async () => {
    const nested = join(dir, "a", "b");
    await new FileTokenStore(nested).save(tokens);
    await expect(new FileTokenStore(nested).load()).resolves.toEqual(tokens);
  });

  it("writes token files with owner-only permissions", async () => {
    await new FileTokenStore(dir).save(tokens);
    const mode = (await stat(join(dir, "oauth1_token.json"))).mode & 0o777;
    // Windows does not honour POSIX modes; assert only where it is meaningful.
    if (process.platform !== "win32") expect(mode).toBe(0o600);
  });

  it("clear removes both files and load returns null", async () => {
    const store = new FileTokenStore(dir);
    await store.save(tokens);
    await store.clear();
    await expect(store.load()).resolves.toBeNull();
  });

  it("returns null rather than throwing when only one file exists", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "oauth1_token.json"), JSON.stringify(tokens.oauth1));
    await expect(new FileTokenStore(dir).load()).resolves.toBeNull();
  });

  it("returns null when oauth1_token.json is an empty object", async () => {
    await writeFile(join(dir, "oauth1_token.json"), "{}");
    await writeFile(join(dir, "oauth2_token.json"), JSON.stringify(tokens.oauth2));
    await expect(new FileTokenStore(dir).load()).resolves.toBeNull();
  });

  it("returns null when oauth1_token.json is missing oauth_token_secret", async () => {
    await writeFile(
      join(dir, "oauth1_token.json"),
      JSON.stringify({ oauth_token: "o1", mfa_token: null }),
    );
    await writeFile(join(dir, "oauth2_token.json"), JSON.stringify(tokens.oauth2));
    await expect(new FileTokenStore(dir).load()).resolves.toBeNull();
  });

  it("returns null when oauth2_token.json is missing access_token", async () => {
    await writeFile(join(dir, "oauth1_token.json"), JSON.stringify(tokens.oauth1));
    await writeFile(
      join(dir, "oauth2_token.json"),
      JSON.stringify({ ...tokens.oauth2, access_token: undefined }),
    );
    await expect(new FileTokenStore(dir).load()).resolves.toBeNull();
  });

  it("ignores .tmp files left behind by a crashed save", async () => {
    // Write the real files
    await writeFile(join(dir, "oauth1_token.json"), JSON.stringify(tokens.oauth1));
    await writeFile(join(dir, "oauth2_token.json"), JSON.stringify(tokens.oauth2));
    // Write temp files that should be ignored
    await writeFile(join(dir, "oauth1_token.json.tmp"), "garbage");
    await writeFile(join(dir, "oauth2_token.json.tmp"), "garbage");
    // Load should succeed and not be affected by .tmp files
    const loaded = await new FileTokenStore(dir).load();
    expect(loaded?.oauth1.oauth_token).toBe("o1");
    expect(loaded?.oauth2.access_token).toBe("at");
  });
});
