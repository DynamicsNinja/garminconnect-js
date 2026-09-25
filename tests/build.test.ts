import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function listTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTsFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

describe("package contract", () => {
  it("declares zero runtime dependencies", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    // Assert the key is present AND empty. `pkg.dependencies ?? {}` would
    // treat a missing key the same as an empty object, which is exactly the
    // failure mode `npm pkg set` can silently introduce (it rewrites the
    // whole file and can drop an empty object key entirely).
    expect(Object.hasOwn(pkg, "dependencies")).toBe(true);
    expect(pkg.dependencies).toEqual({});
  });

  it("requires Node 18 or newer", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    expect(pkg.engines.node).toBe(">=18");
  });

  it("gives import and require each their own types, listed first", async () => {
    // One shared `types` ahead of both pointed CommonJS projects at the ESM `.d.ts`, which fails
    // under `"module": "node16"` with TS1479. `tests/dist.test.ts` compiles a real consumer.
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    for (const [subpath, ext] of [[".", "index"], ["./exercises", "exercises"]] as const) {
      const entry = pkg.exports[subpath];
      expect(Object.keys(entry.import)[0], `${subpath} import`).toBe("types");
      expect(Object.keys(entry.require)[0], `${subpath} require`).toBe("types");
      expect(entry.import.types).toBe(`./dist/${ext}.d.ts`);
      expect(entry.require.types).toBe(`./dist/${ext}.d.cts`);
    }
  });

  it("does not import React or DOM-only globals anywhere in src", async () => {
    const files = await listTsFiles("src");
    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source, `${file} must stay server-only`).not.toMatch(
        /from "react"|\bdocument\.|\bwindow\.|\bglobalThis\.window\b|\bnavigator\.|\blocalStorage\b|\bsessionStorage\b/,
      );
    }
  });
});
