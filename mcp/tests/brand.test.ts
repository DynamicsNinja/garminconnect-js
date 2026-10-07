import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORDMARK_DARK, WORDMARK_LIGHT } from "../src/brand.js";

const asset = (name: string) => readFileSync(new URL(`../../docs/assets/${name}`, import.meta.url), "utf8");

describe("brand", () => {
  it("embeds the README wordmarks verbatim, so they cannot drift", () => {
    expect(WORDMARK_LIGHT).toBe(asset("title-light.svg"));
    expect(WORDMARK_DARK).toBe(asset("title-dark.svg"));
  });
});
