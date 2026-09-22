// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Hard constraint: no `any` in exported (or any) signatures. Kept as
      // an explicit error, not left at the ruleset default, so it is a real
      // backstop for the ~145 endpoint methods a follow-up plan adds across
      // many new service files written from a template under less scrutiny
      // than this task received. If a genuine `unknown`-narrowing boundary
      // needs `any` later, disable it inline at that one site with a reason,
      // not here.
      "@typescript-eslint/no-explicit-any": "error",
      // Template literals over template-friendly primitives (numbers,
      // booleans) read fine and are used throughout for building URLs and
      // messages; not worth the noise of unicorn-style restrictions here.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      // TokenStore implementations and mocked fetch stand-ins routinely
      // implement an async interface (Promise-returning by contract) with a
      // body that happens not to need to `await` anything. Forcing a
      // `Promise.resolve()` wrapper or a no-op await at every such site adds
      // noise without catching a real bug.
      "@typescript-eslint/require-await": "off",
      // Leading-underscore parameters are this codebase's convention for
      // "required by a callback signature but intentionally unused".
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["tests/**/*.ts", "scripts/**/*.ts"],
    rules: {
      // Test and script code intentionally reaches into internals and uses
      // loose typing (fixtures, mocked fetch, CLI prompts) that the
      // type-checked ruleset is too aggressive about.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      // Assertion messages coerce a mocked fetch call's first argument
      // (typed as `RequestInfo | URL`, a union without a guaranteed
      // `toString`) with an explicit `String(...)` call. That is exactly the
      // safe, explicit form this rule exists to steer people toward, so
      // flagging it here is a false positive.
      "@typescript-eslint/no-base-to-string": "off",
      // Catch-clause parameters in scripts may be deliberately ignored (e.g.,
      // when only the presence of an exception matters, not its details).
      // Allowing underscore-prefixed names sidesteps the need for empty blocks.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
);
