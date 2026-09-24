import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every relative link and in-page anchor across the shipped Markdown must resolve.
 *
 * This exists because the generated API pages shipped with a link to `README.md#-quick-start`,
 * an anchor that has never existed — the README's heading is "Installation & setup". A broken
 * link is invisible to every other check here: it is valid Markdown, the file it lives in is
 * generated correctly, and nothing type-checks a URL. It is only found by someone clicking it,
 * which for a published package means a stranger.
 */
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Markdown files that ship or are linked from ones that do. */
function markdownFiles(): string[] {
  const out = ["README.md", "AGENTS.md", "WORKOUTS.md"].map((f) => path.join(ROOT, f));
  const apiDir = path.join(ROOT, "docs", "api");
  for (const f of readdirSync(apiDir)) {
    if (f.endsWith(".md")) out.push(path.join(apiDir, f));
  }
  return out.filter((f) => existsSync(f));
}

/**
 * GitHub's anchor rule, as `github-slugger` implements it: lowercase, strip anything that is not
 * a word character, space or hyphen, then replace EACH space with a hyphen.
 *
 * The "each" matters and is easy to get wrong — collapsing runs of whitespace first gives a
 * different slug for any heading with punctuation between words. `## 📦 Installation & setup`
 * drops the emoji and the ampersand, leaving two runs of spaces, and so anchors as
 * `-installation--setup` with a DOUBLE hyphen. A collapsing implementation says
 * `-installation-setup`, and then this test rejects the correct link.
 */
function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  for (const m of markdown.matchAll(/^#{1,6} +(.+?)\s*$/gm)) {
    const text = m[1]!
      .replace(/<a id="([^"]+)"><\/a>/g, (_, id: string) => {
        anchors.add(id.toLowerCase());
        return "";
      })
      .replace(/`/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    anchors.add(
      text
        .trim()
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/ /g, "-"),
    );
  }
  // Explicit anchor spans anywhere in the document, not only in headings.
  for (const m of markdown.matchAll(/<a id="([^"]+)">/g)) anchors.add(m[1]!.toLowerCase());
  return anchors;
}

describe("documentation links", () => {
  const files = markdownFiles();

  it("has documentation to check at all", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("resolves every relative file link", () => {
    const broken: string[] = [];
    for (const file of files) {
      const dir = path.dirname(file);
      const content = readFileSync(file, "utf8");
      for (const m of content.matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)(#[^)]*)?\)/g)) {
        const target = path.resolve(dir, m[1]!);
        if (!existsSync(target)) {
          broken.push(`${path.relative(ROOT, file)} -> ${m[1]!}`);
        }
      }
    }
    expect(broken, `broken relative link(s):\n  ${broken.join("\n  ")}`).toEqual([]);
  });

  it("resolves every cross-file anchor", () => {
    // The one that actually shipped: a link to a heading that does not exist in the target file.
    const broken: string[] = [];
    for (const file of files) {
      const dir = path.dirname(file);
      const content = readFileSync(file, "utf8");
      for (const m of content.matchAll(/\]\((?!https?:|mailto:)([^)\s#]+)#([^)]+)\)/g)) {
        const target = path.resolve(dir, m[1]!);
        if (!existsSync(target)) continue; // reported by the test above
        const anchors = anchorsOf(readFileSync(target, "utf8"));
        if (!anchors.has(m[2]!.toLowerCase())) {
          broken.push(`${path.relative(ROOT, file)} -> ${m[1]!}#${m[2]!}`);
        }
      }
    }
    expect(broken, `link(s) to a non-existent heading:\n  ${broken.join("\n  ")}`).toEqual([]);
  });
});
