/**
 * The project's published docs carry no em dashes (U+2014). Generated pages pull prose from
 * AGENTS.md, JSDoc and type declarations, so an em dash in any of those would reach the site.
 *
 * This is a safety net, not a fixer: it refuses the output rather than rewriting it, because the
 * right replacement (a period, colon, parentheses, a semicolon or a comma) depends on the sentence
 * and only a person can choose it. Fix the source text, then regenerate.
 */
const EM = "—";

export function assertNoEmDashes(text: string, label: string): string {
  if (!text.includes(EM)) return text;
  const hits = text
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => line.includes(EM))
    .map(({ line, n }) => `  ${label}:${String(n)}: ${line.trim().slice(0, 160)}`);
  throw new Error(
    `Em dash (U+2014) in generated output. Fix the source text (AGENTS.md, JSDoc or a type ` +
      `declaration) with the punctuation the sentence needs, then regenerate:\n${hits.join("\n")}`,
  );
}
