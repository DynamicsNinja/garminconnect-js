/**
 * The project's docs carry no em dashes (U+2014). Generated pages pull prose from AGENTS.md and
 * JSDoc, which do use them, so the generators pass their output through this.
 */
const EM = "—";

export function stripEmDashes(text: string): string {
  return text
    .replace(new RegExp(` ${EM} *(\r?)$`, "gm"), ",$1")
    .replace(new RegExp(` ${EM} `, "g"), ", ")
    .replace(new RegExp(EM, "g"), ", ");
}
