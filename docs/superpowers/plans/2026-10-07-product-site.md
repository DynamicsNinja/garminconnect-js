# garmin.ficdev.xyz product site — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new Next.js site at `garmin.ficdev.xyz` (path `/`). It covers:
- a landing page with two doors;
- `/claude` connector setup;
- full docs synced from the npm packages, including a reference generated from the manifest;
- the existing demo, moved to `/demo`.

**Architecture:** One Next.js 16 App Router app in a new repo, `garminconnect-site`.
- **Docs pipeline:** a build-time module reads the docs that `garminconnect-js@0.9.0` and `@dynamicsninja/garminconnect-mcp@0.9.0` ship in `node_modules`, splits the README into pages, and renders markdown with unified/remark/rehype and shiki. It rewrites links to site routes or GitHub at the version tag, and fails the build on anything broken.
- **Reference:** generated from `GARMIN_METHODS`.
- **Search:** a static JSON index.
- **Demo:** copied from `garminconnect-nextjs-starter` under `/demo`.
- **Deployment:** a standalone Docker image.

**Tech Stack:**
- Next.js 16.3.6, React 19.2.8, TypeScript, Node 22.
- Markdown: unified, remark-parse, remark-gfm, remark-rehype, rehype-raw, rehype-slug, @shikijs/rehype, rehype-stringify.
- github-slugger and minisearch.
- Tests: vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-product-site-design.md` in the `garminconnect` repo. Task 1 copies it into the new repo.

## Refinements to the spec (decided while planning)

1. **No user-agent sniffing on `/claude`.** The default tab, "claude.ai & mobile", already covers phones and the web. Each tab has its own URL (`?app=desktop`), so the page stays static. Success criterion 1 holds, because a phone visitor lands on the right tab.
2. **Anchors are GitHub-compatible** (`#-installation--setup`), not emoji-stripped. The README's own links use GitHub's slugs, so matching them keeps every in-page link working.
3. **An extra route, `/docs/api`,** renders `docs/api/README.md` (the category index).
4. **The README "API coverage" section is not a site page.** `/docs/reference` replaces it, and links to it go to `/docs/reference`.

## Global Constraints

- Repo: `C:\Users\ificko\source\repos\garminconnect-site`, branch `main`. Commit directly on main and push after each task (the user's rule). Creating the GitHub repo needs the user's go-ahead (Task 1).
- Node 22. `next@16.3.6`, `react@19.2.8`, `react-dom@19.2.8`, matching the starter.
- The docs packages are pinned EXACTLY: `"garminconnect-js": "0.9.0"`, `"@dynamicsninja/garminconnect-mcp": "0.9.0"`.
- No analytics, no third-party scripts, no external fonts, no network fetches at runtime for docs.
- Brand: the README wordmark (`docs/assets/title-light.svg`, `title-dark.svg` from the library repo, copied into `public/brand/`), the gradient `#0969DA → #0A8F7F` for primary actions, and GitHub-like neutrals. Light and dark follow the system. Nothing scrolls sideways at 360 px.
- The connector URL is exactly `https://garmin.ficdev.xyz/mcp`.
- Docs come ONLY from the pinned packages' files. The build fails if a required README section is missing, if an internal link or anchor doesn't resolve, or if a manifest method has no reference page.
- The demo keeps its env (`GARMIN_PUBLIC`, `GARMIN_DEMO`, `SESSION_SECRET`, `PRIVACY_CONTACT`, `GARMIN_TOKEN_DIR`), its behaviour and its cookie path `/`.
- Server-only modules never reach client bundles (`import "server-only"` where the demo had it).
- Commit messages end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Every heading-anchor link** in the rendered README sections and `docs/api` pages must land on a real id on the target page. Test in Task 3 (link check over all pages).
2. **A phone at 375 px:** the landing cards stack, the URL copy box doesn't overflow, the docs sidebar collapses into a menu, and the reference table scrolls inside its own box, not the page. Playwright in Task 10.
3. **The copy button** works on HTTPS and falls back to selecting the text when `navigator.clipboard` is unavailable. Test in Task 6.
4. **Demo links and redirects** all point under `/demo` (sign-in, sign-out, back links). The privacy link goes to `/privacy`. Test in Task 9.
5. **The reference filters and search** behave without JavaScript errors when a method has no params or several categories match. Tests in Tasks 4 and 7.

## File structure (new repo)

```
garminconnect-site/
  package.json, tsconfig.json, next.config.ts, eslint.config.mjs, vitest.config.ts, playwright.config.ts
  Dockerfile, .dockerignore, .gitignore, .env.example, README.md
  .github/workflows/ci.yml, .github/dependabot.yml
  docs/spec.md                      (copy of the design spec)
  public/brand/title-light.svg, title-dark.svg, social-preview.png
  src/app/layout.tsx, globals.css, page.tsx (landing), page.module.css
  src/app/claude/page.tsx, claude.module.css
  src/app/privacy/page.tsx
  src/app/docs/layout.tsx, docs.module.css
  src/app/docs/page.tsx                         (/docs)
  src/app/docs/[slug]/page.tsx                  (/docs/authentication, examples, workouts, self-host, changelog)
  src/app/docs/api/page.tsx, [category]/page.tsx
  src/app/docs/reference/page.tsx, [method]/page.tsx, ReferenceTable.tsx
  src/app/search-index.json/route.ts
  src/app/demo/page.tsx, actions.ts, page.module.css
  src/components/Header.tsx, Footer.tsx, Search.tsx, CopyUrl.tsx, Wordmark.tsx, DocsNav.tsx, Toc.tsx
  src/components/demo/charts.tsx, charts.module.css, LoginForm.tsx, LoginForm.module.css
  src/lib/docs/sources.ts      (read package files + versions)
  src/lib/docs/readme.ts       (split README into named sections)
  src/lib/docs/render.ts       (markdown → html + headings + links)
  src/lib/docs/links.ts        (link rewriting rules)
  src/lib/docs/registry.ts     (all doc pages, cached; link check)
  src/lib/reference.ts         (manifest → reference data, tool names)
  src/lib/search.ts            (build the search index)
  src/lib/demo/*               (copied demo libs)
  tests/*.test.ts, e2e/*.spec.ts
```

---

### Task 1: Scaffold the repo

**Files:** everything at the root listed above except `src/lib/docs/*`, `src/app/docs/*`, the landing/claude/privacy/demo pages, and `e2e/*`. Those come later.

**Interfaces — Produces:**
- The scripts `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`.
- An app that builds and serves a placeholder `/`.

- [ ] **Step 1: Ask the user** whether to create the GitHub repo `DynamicsNinja/garminconnect-site`, and whether it should be public or private. Do nothing on GitHub before they answer.

- [ ] **Step 2: Create the project.** In `C:\Users\ificko\source\repos`:

```bash
mkdir garminconnect-site && cd garminconnect-site && git init -b main
```

Write `package.json`:

```json
{
  "name": "garminconnect-site",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "next dev -H 127.0.0.1",
    "build": "next build",
    "start": "next start -H 0.0.0.0 -p ${PORT:-3000}",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@dynamicsninja/garminconnect-mcp": "0.9.0",
    "garminconnect-js": "0.9.0",
    "next": "16.3.6",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "server-only": "^0.0.1"
  }
}
```

Then run:

```bash
npm install unified remark-parse remark-gfm remark-rehype rehype-raw rehype-slug rehype-stringify @shikijs/rehype shiki github-slugger minisearch unist-util-visit
npm install -D typescript @types/node@22 @types/react @types/react-dom eslint eslint-config-next@16.3.6 vitest @playwright/test @types/hast @types/mdast
```

`tsconfig.json`: copy the starter's (`../garminconnect-nextjs-starter/tsconfig.json`). Add `"tests"` and `"e2e"` to `include`.

`eslint.config.mjs`: copy the starter's.

`next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // The docs pipeline reads these packages' files from node_modules at build time.
  outputFileTracingIncludes: {
    "/docs/**": ["./node_modules/garminconnect-js/**/*.md", "./node_modules/@dynamicsninja/garminconnect-mcp/README.md"],
  },
};

export default nextConfig;
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Next's tsconfig uses "jsx": "preserve"; tests import page modules, so compile JSX here.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `import "server-only"` throws outside Next; tests run server code directly.
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
```

`tests/server-only-stub.ts`: `export {};`

(Use the same `@/*` path alias in `tsconfig.json`: `"paths": { "@/*": ["./src/*"] }`.)

`.gitignore`: `node_modules/ .next/ out/ test-results/ playwright-report/ .env*.local .env .garmin-tokens/`

- [ ] **Step 3: Brand assets.** Copy these into `public/brand/`:
  - `../garminconnect/docs/assets/title-light.svg`
  - `../garminconnect/docs/assets/title-dark.svg`
  - `../garminconnect/docs/assets/social-preview.png`

  Also copy `../garminconnect-nextjs-starter/src/app/favicon.ico` to `src/app/favicon.ico`. Copy `../garminconnect/docs/superpowers/specs/2026-10-07-product-site-design.md` to `docs/spec.md`.

- [ ] **Step 4: A placeholder page so the build works.** In `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://garmin.ficdev.xyz"),
  title: { default: "garminconnect-js — Garmin Connect for Claude and for your code", template: "%s · garminconnect-js" },
  description: "Use your Garmin data in Claude with no install, or build with a zero-dependency TypeScript client for Garmin Connect.",
  openGraph: { images: ["/brand/social-preview.png"] },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`: `export default function Home() { return <main>garminconnect-js</main>; }`. `src/app/globals.css`: empty for now (Task 2 fills it).

- [ ] **Step 5: CI, Dependabot, Docker.** `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run build
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
```

`.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: daily }
    allow:
      - dependency-name: garminconnect-js
      - dependency-name: "@dynamicsninja/garminconnect-mcp"
    versioning-strategy: increase
```

`Dockerfile`:

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
```

`.dockerignore`: `node_modules .next .git .env .env.* .garmin-tokens test-results playwright-report`

`.env.example`: copy the starter's `.env.example` verbatim, then add a first line `# The /demo page's settings (unchanged from garminconnect-nextjs-starter).`

`playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  webServer: { command: "npm run start", port: 3000, reuseExistingServer: !process.env.CI, env: { PORT: "3000", GARMIN_DEMO: "1", SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e" } },
  use: { baseURL: "http://127.0.0.1:3000" },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
});
```

(`e2e/` starts empty. Add an `e2e/smoke.spec.ts` with one test that `/` returns 200, so the CI step passes.)

`README.md`: what the site is, how to run it (`npm ci && npm run dev`), how docs sync (the pinned packages plus Dependabot), and that the deployment is in Dokploy behind the Cloudflare Tunnel.

- [ ] **Step 6: Verify.** Run `npm run typecheck && npm run lint && npm test -- --passWithNoTests && npm run build`, then `npx playwright install chromium && npm run test:e2e`. All must PASS.

- [ ] **Step 7: Commit and publish.**

```bash
git add -A && git commit -m "chore: scaffold the garmin.ficdev.xyz site" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If the user approved in Step 1, run `gh repo create DynamicsNinja/garminconnect-site --<public|private> --source . --push`. Otherwise stop after the local commit and report.

---

### Task 2: Shell — brand, header, footer, theme

**Files:**
- Create `src/components/Wordmark.tsx`, `Header.tsx`, `Footer.tsx`; fill `src/app/globals.css`.
- Modify `src/app/layout.tsx`.
- Test: `tests/brand.test.ts`.

**Interfaces — Produces:**
- `<Wordmark className?>`.
- `<Header />`, with links Claude `/claude`, Docs `/docs`, Demo `/demo`, GitHub, and a search slot (Task 7 fills it).
- `<Footer />`.
- CSS custom properties `--fg --muted --bg --bg-subtle --border --accent --accent-2 --radius` in `:root` and in `@media (prefers-color-scheme: dark)`.
- Utility classes `.container` (max-width 1100 px, padding 0 16 px), `.btn`, `.btn-primary` (the gradient), `.btn-ghost`, and `.mono`.

- [ ] **Step 1: Failing test.** `tests/brand.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("brand assets", () => {
  it("ships both wordmarks and the social image", () => {
    for (const f of ["title-light.svg", "title-dark.svg"]) {
      expect(readFileSync(`public/brand/${f}`, "utf8")).toContain("<svg");
    }
    expect(readFileSync("public/brand/social-preview.png").subarray(1, 4).toString()).toBe("PNG");
  });
  it("uses the brand gradient for primary actions", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/--accent:\s*#0969DA/i);
    expect(css).toMatch(/--accent-2:\s*#0A8F7F/i);
    expect(css).toMatch(/\.btn-primary\s*\{[^}]*linear-gradient\(90deg,\s*var\(--accent\),\s*var\(--accent-2\)\)/);
  });
});
```

Run `npx vitest run tests/brand.test.ts`. Expect a FAIL on the CSS assertions.

- [ ] **Step 2: Implement.**

`Wordmark.tsx`:

```tsx
/** The README wordmark; the dark variant is swapped in by CSS (prefers-color-scheme). */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`wordmark ${className ?? ""}`}>
      <img src="/brand/title-light.svg" alt="garminconnect-js" className="wordmark-light" width={705} height={136} />
      <img src="/brand/title-dark.svg" alt="" aria-hidden="true" className="wordmark-dark" width={705} height={136} />
    </span>
  );
}
```

`Header.tsx`: a server component with `<header className="site-header"><div className="container site-header-inner">`. Inside it go a `Link` to `/` holding `<Wordmark className="wordmark-sm"/>`, then `<nav>` with links Claude, Docs, Demo and GitHub (`https://github.com/DynamicsNinja/garminconnect-js`, `rel="noopener noreferrer"`), then `<div id="search-slot" />`.

`Footer.tsx`: muted, small. The line is "Open source · garminconnect-js on GitHub · Not affiliated with Garmin · Privacy" (the last links to `/privacy`), plus the docs version line `Docs for garminconnect-js {version}`, with the version read from `garminconnect-js/package.json` via `import pkg from "garminconnect-js/package.json"`.

`globals.css` (complete):

```css
:root {
  --fg: #1f2328; --muted: #59636e; --bg: #ffffff; --bg-subtle: #f6f8fa; --border: #d0d7de;
  --accent: #0969DA; --accent-2: #0A8F7F; --radius: 10px;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --fg: #e6edf3; --muted: #9198a1; --bg: #0d1117; --bg-subtle: #161b22; --border: #30363d; }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg); overflow-x: hidden; }
a { color: var(--accent); }
.container { max-width: 1100px; margin: 0 auto; padding: 0 16px; }
.mono, code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 16px; border-radius: 8px; font-weight: 600; text-decoration: none; border: 1px solid transparent; cursor: pointer; font-size: 15px; }
.btn-primary { background: linear-gradient(90deg, var(--accent), var(--accent-2)); color: #fff; }
.btn-ghost { border-color: var(--border); color: var(--fg); background: var(--bg); }
.btn:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 50%, transparent); outline-offset: 2px; }
.site-header { border-bottom: 1px solid var(--border); background: var(--bg); position: sticky; top: 0; z-index: 10; }
.site-header-inner { display: flex; align-items: center; gap: 16px; height: 56px; }
.site-header nav { display: flex; gap: 16px; margin-left: auto; }
.site-header nav a { color: var(--fg); text-decoration: none; font-size: 15px; }
.wordmark img { display: block; height: auto; }
.wordmark-sm img { width: 170px; }
.wordmark-dark { display: none !important; }
@media (prefers-color-scheme: dark) { .wordmark-light { display: none !important; } .wordmark-dark { display: block !important; } }
.site-footer { border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; padding: 24px 0; margin-top: 64px; }
@media (max-width: 640px) { .site-header nav a.hide-sm { display: none; } .wordmark-sm img { width: 140px; } }
```

(On phones the header shows the wordmark plus Claude, Docs and the search button; mark the Demo and GitHub links `className="hide-sm"`.)

`layout.tsx`: render `<Header />`, then `{children}`, then `<Footer />` inside `<body>`.

- [ ] **Step 3: Verify.** Run `npx vitest run tests/brand.test.ts` (PASS), then `npm run build`.

- [ ] **Step 4: Commit and push.** Message: `feat: site shell with the library's branding`.

---

### Task 3: Docs pipeline (sources, README sections, render, links, registry)

**Files:**
- Create `src/lib/docs/sources.ts`, `readme.ts`, `links.ts`, `render.ts`, `registry.ts`.
- Test: `tests/docs.test.ts`.

**Interfaces — Produces:**

```ts
// sources.ts
export interface SourceFile { pkg: "lib" | "mcp"; repoPath: string; text: string } // repoPath is the path in the GitHub repo, e.g. "README.md", "docs/api/gear.md", "mcp/README.md"
export function libVersion(): string;                       // garminconnect-js package.json version
export function readSource(repoPath: string): SourceFile;   // reads from node_modules/garminconnect-js or node_modules/@dynamicsninja/garminconnect-mcp (for "mcp/README.md")
export function apiCategoryFiles(): string[];               // ["docs/api/activities.md", …] sorted, excluding README.md
// readme.ts
export const README_PAGES: { route: string; title: string; sections: string[] }[]; // sections = heading texts without emoji, e.g. "Installation & setup"
export function splitReadme(markdown: string): Map<string, string>;                // normalized h2 title → markdown of that section (heading included)
export function normalizeHeading(text: string): string;                            // strip emoji/symbols, trim, collapse spaces
// links.ts
export interface LinkTarget { route: string; anchor?: string }                      // a site route, or { route: "https://…" } for external
export function resolveLink(href: string, fromRepoPath: string, ctx: LinkContext, kind: "a" | "img"): LinkTarget;
export interface LinkContext { version: string; routeForFile(repoPath: string, anchor?: string): string | null }
// render.ts
export interface Rendered { html: string; headings: { depth: number; id: string; text: string }[]; links: LinkTarget[] }
export function renderMarkdown(markdown: string, fromRepoPath: string, ctx: LinkContext): Promise<Rendered>;
// registry.ts
export interface DocPage { route: string; title: string; html: string; headings: Rendered["headings"]; sourceRepoPath: string }
export function getDocPages(): Promise<Map<string, DocPage>>;  // cached
export function getDocPage(route: string): Promise<DocPage>;   // throws if missing
export function checkLinks(pages: Map<string, DocPage>, links: Map<string, LinkTarget[]>): string[]; // problems, empty = ok
```

The page routes the registry produces:

| Route | Title | Source |
|---|---|---|
| `/docs` | Getting started | README sections "About", "Installation & setup" |
| `/docs/authentication` | Authentication | README "Authentication" |
| `/docs/examples` | Code examples | README "Code examples" |
| `/docs/workouts` | Building workouts | `WORKOUTS.md` |
| `/docs/api` | API by category | `docs/api/README.md` |
| `/docs/api/<name>` | the file's first `# heading` | `docs/api/<name>.md` |
| `/docs/self-host` | Run it yourself | `mcp/README.md` |
| `/docs/changelog` | Changelog | `CHANGELOG.md` |

`routeForFile(repoPath, anchor)` rules:
- `README.md` + anchor → the page whose sections contain that anchor's heading.
- `README.md` + an anchor in "API coverage" → `/docs/reference`.
- `README.md` + an anchor in another section → `null`, so it links to GitHub.
- `README.md` with no anchor → `/docs`.
- `WORKOUTS.md` → `/docs/workouts`; `CHANGELOG.md` → `/docs/changelog`.
- `docs/api/README.md` → `/docs/api`; `docs/api/x.md` → `/docs/api/x`.
- `mcp/README.md` → `/docs/self-host`.
- Anything else → `null`.

`resolveLink` rules (`version` comes from `libVersion()`; the GitHub repo is `DynamicsNinja/garminconnect-js`):
1. `http:`, `https:` or `mailto:` → unchanged (`{ route: href }`).
2. `#x` → the same file with anchor `x`.
3. Relative → resolve against `posix.dirname(fromRepoPath)`. A path escaping the repo root throws `Error("link escapes the repo: …")`.
4. If `kind === "img"` → `https://raw.githubusercontent.com/DynamicsNinja/garminconnect-js/v<version>/<path>`.
5. If `routeForFile` returns a route → `{ route, anchor }`.
6. Otherwise → `https://github.com/DynamicsNinja/garminconnect-js/blob/v<version>/<path>` + `#anchor` if there is one (a `tree/` URL when the path has no extension).

`checkLinks` reports every site-route link whose route isn't in `pages`, or whose anchor isn't among that page's heading ids or raw `id="…"`/`name="…"` attributes in its html.

- [ ] **Step 1: Failing tests.** `tests/docs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeHeading, splitReadme, README_PAGES } from "@/lib/docs/readme";
import { resolveLink, type LinkContext } from "@/lib/docs/links";
import { getDocPages, checkLinks } from "@/lib/docs/registry";
import { apiCategoryFiles, libVersion, readSource } from "@/lib/docs/sources";

const ctx: LinkContext = {
  version: "9.9.9",
  routeForFile: (p, a) => (p === "WORKOUTS.md" ? "/docs/workouts" : p === "docs/api/gear.md" ? "/docs/api/gear" : p === "README.md" && a === "-authentication" ? "/docs/authentication" : null),
};

describe("readme", () => {
  it("normalizes emoji headings", () => {
    expect(normalizeHeading("📦 Installation & setup")).toBe("Installation & setup");
    expect(normalizeHeading("ℹ️ About")).toBe("About");
  });
  it("finds every section the site needs in the pinned README", () => {
    const sections = splitReadme(readSource("README.md").text);
    for (const page of README_PAGES) for (const s of page.sections) expect(sections.has(s), s).toBe(true);
  });
});

describe("links", () => {
  it("maps rendered files to routes and the rest to GitHub at the tag", () => {
    expect(resolveLink("../../WORKOUTS.md", "docs/api/gear.md", ctx, "a")).toEqual({ route: "/docs/workouts" });
    expect(resolveLink("gear.md", "docs/api/README.md", ctx, "a")).toEqual({ route: "/docs/api/gear" });
    expect(resolveLink("../../README.md#-authentication", "docs/api/gear.md", ctx, "a")).toEqual({ route: "/docs/authentication", anchor: "-authentication" });
    expect(resolveLink("AGENTS.md", "README.md", ctx, "a")).toEqual({ route: "https://github.com/DynamicsNinja/garminconnect-js/blob/v9.9.9/AGENTS.md" });
    expect(resolveLink("examples", "README.md", ctx, "a")).toEqual({ route: "https://github.com/DynamicsNinja/garminconnect-js/tree/v9.9.9/examples" });
    expect(resolveLink("docs/assets/title-light.svg", "README.md", ctx, "img")).toEqual({ route: "https://raw.githubusercontent.com/DynamicsNinja/garminconnect-js/v9.9.9/docs/assets/title-light.svg" });
    expect(resolveLink("https://x.y/z", "README.md", ctx, "a")).toEqual({ route: "https://x.y/z" });
    expect(() => resolveLink("../../../etc/passwd", "docs/api/gear.md", ctx, "a")).toThrow(/escapes/);
  });
});

describe("registry", () => {
  it("renders every page with no broken internal link or anchor", async () => {
    const pages = await getDocPages();
    expect([...pages.keys()]).toEqual(expect.arrayContaining(["/docs", "/docs/authentication", "/docs/examples", "/docs/workouts", "/docs/api", "/docs/self-host", "/docs/changelog"]));
    for (const f of apiCategoryFiles()) expect(pages.has(`/docs/api/${f.slice("docs/api/".length, -3)}`)).toBe(true);
    const { getAllLinks } = await import("@/lib/docs/registry");
    expect(checkLinks(pages, await getAllLinks())).toEqual([]);
  });
  it("uses the pinned library version", () => {
    expect(libVersion()).toBe("0.9.0");
  });
  it("highlights code at build time and keeps GitHub anchors", async () => {
    const page = (await getDocPages()).get("/docs")!;
    expect(page.html).toContain('id="-installation--setup"');
    expect(page.html).toMatch(/<pre class="shiki/);
  });
});
```

(`registry.ts` also exports `getAllLinks(): Promise<Map<string, LinkTarget[]>>`, the links collected per page during rendering.)

Run `npx vitest run tests/docs.test.ts`. Expect a FAIL (modules missing).

- [ ] **Step 2: Implement `sources.ts`.**

```ts
import "server-only";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const LIB = path.join(process.cwd(), "node_modules", "garminconnect-js");
const MCP = path.join(process.cwd(), "node_modules", "@dynamicsninja", "garminconnect-mcp");

export interface SourceFile { pkg: "lib" | "mcp"; repoPath: string; text: string }

export function libVersion(): string {
  return (JSON.parse(readFileSync(path.join(LIB, "package.json"), "utf8")) as { version: string }).version;
}

export function readSource(repoPath: string): SourceFile {
  if (repoPath === "mcp/README.md") return { pkg: "mcp", repoPath, text: readFileSync(path.join(MCP, "README.md"), "utf8") };
  return { pkg: "lib", repoPath, text: readFileSync(path.join(LIB, ...repoPath.split("/")), "utf8") };
}

export function apiCategoryFiles(): string[] {
  return readdirSync(path.join(LIB, "docs", "api")).filter((f) => f.endsWith(".md") && f !== "README.md").sort().map((f) => `docs/api/${f}`);
}
```

(`server-only` is aliased to a stub in `vitest.config.ts`, from Task 1, so these modules load in tests.)
Known edge: rehype-slug numbers duplicate headings per rendered page (`-1`, `-2`), whereas GitHub numbers them across the whole README. The link check in Step 7 catches any anchor this breaks.

- [ ] **Step 3: Implement `readme.ts`.**

```ts
export const README_PAGES = [
  { route: "/docs", title: "Getting started", sections: ["About", "Installation & setup"] },
  { route: "/docs/authentication", title: "Authentication", sections: ["Authentication"] },
  { route: "/docs/examples", title: "Code examples", sections: ["Code examples"] },
] as const satisfies readonly { route: string; title: string; sections: readonly string[] }[];

/** Sections whose anchors go to a site page other than a README page. */
export const README_REDIRECTS: Record<string, string> = { "API coverage": "/docs/reference", "Building workouts": "/docs/workouts", "Use it from Claude": "/claude" };

export function normalizeHeading(text: string): string {
  // \p{Extended_Pictographic} covers emoji such as ℹ (U+2139), which is otherwise a LETTER (category Ll).
  return text.replace(/<[^>]+>/g, "").replace(/[\p{Extended_Pictographic}️‍]/gu, "").replace(/\s+/g, " ").trim();
}

/** Level-2 sections of the README, keyed by normalized title; each value starts with its own heading line. */
export function splitReadme(markdown: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = markdown.split(/\r?\n/);
  let title: string | null = null;
  let buf: string[] = [];
  let inFence = false;
  const flush = () => { if (title) out.set(title, buf.join("\n")); };
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    const m = !inFence && /^## (.+)$/.exec(line);
    if (m) { flush(); title = normalizeHeading(m[1]!); buf = [line]; } else if (title) buf.push(line);
  }
  flush();
  return out;
}
```

- [ ] **Step 4: Implement `links.ts`** exactly as the rules above, using `node:path`'s `posix.normalize`/`posix.join`. Split off `#anchor` and `?query` first. For `README.md` anchors, `routeForFile` is supplied by the registry, so `links.ts` stays pure.

- [ ] **Step 5: Implement `render.ts`.**

```ts
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import rehypeShiki from "@shikijs/rehype";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import type { Element, Root } from "hast";
import { resolveLink, type LinkContext, type LinkTarget } from "./links";

export interface Rendered { html: string; headings: { depth: number; id: string; text: string }[]; links: LinkTarget[] }

const textOf = (n: Element): string => n.children.map((c) => (c.type === "text" ? c.value : c.type === "element" ? textOf(c) : "")).join("");

export async function renderMarkdown(markdown: string, fromRepoPath: string, ctx: LinkContext): Promise<Rendered> {
  const headings: Rendered["headings"] = [];
  const links: LinkTarget[] = [];
  const rewrite = () => (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (/^h[1-4]$/.test(node.tagName) && typeof node.properties.id === "string") {
        headings.push({ depth: Number(node.tagName[1]), id: node.properties.id, text: textOf(node).trim() });
      }
      const attr = node.tagName === "a" ? "href" : node.tagName === "img" || node.tagName === "source" ? (node.tagName === "img" ? "src" : "srcSet") : null;
      const value = attr ? node.properties[attr] : undefined;
      if (attr && typeof value === "string" && value) {
        const target = resolveLink(value, fromRepoPath, ctx, node.tagName === "a" ? "a" : "img");
        links.push(target);
        node.properties[attr] = target.anchor ? `${target.route}#${target.anchor}` : target.route;
        if (node.tagName === "a" && /^https?:/.test(target.route)) { node.properties.rel = "noopener noreferrer"; }
      }
    });
  };
  const file = await unified()
    .use(remarkParse).use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw)
    .use(rehypeSlug).use(rewrite)
    .use(rehypeShiki, { themes: { light: "github-light", dark: "github-dark" }, defaultColor: false })
    .use(rehypeStringify)
    .process(markdown);
  return { html: String(file), headings, links };
}
```

The input is trusted: our own pinned packages. That's why raw HTML is allowed; state it in a comment. Strip the `<!-- GENERATED … -->` comments before rendering (`markdown.replace(/<!--[\s\S]*?-->/g, "")`).

Shiki dual themes need this CSS in `globals.css`:

```css
.shiki, .shiki span { color: var(--shiki-light); background-color: var(--shiki-light-bg); }
@media (prefers-color-scheme: dark) { .shiki, .shiki span { color: var(--shiki-dark); background-color: var(--shiki-dark-bg); } }
pre.shiki { padding: 14px 16px; border-radius: 8px; overflow-x: auto; border: 1px solid var(--border); font-size: 14px; }
```

- [ ] **Step 6: Implement `registry.ts`.**

```ts
import { README_PAGES, README_REDIRECTS, splitReadme, normalizeHeading } from "./readme";
import { apiCategoryFiles, libVersion, readSource } from "./sources";
import { renderMarkdown, type Rendered } from "./render";
import type { LinkContext, LinkTarget } from "./links";
import GithubSlugger from "github-slugger";

export interface DocPage { route: string; title: string; html: string; headings: Rendered["headings"]; sourceRepoPath: string }

let cache: Promise<{ pages: Map<string, DocPage>; links: Map<string, LinkTarget[]> }> | null = null;

function readmeAnchorRoutes(readme: string): Map<string, string | null> {
  // Every README heading's GitHub slug → the route its level-2 section landed on (null = GitHub).
  const slugger = new GithubSlugger();
  const map = new Map<string, string | null>();
  let section: string | null = null;
  let inFence = false;
  for (const line of readme.split(/\r?\n/)) {
    if (/^```/.test(line)) inFence = !inFence;
    const m = !inFence && /^(#{1,6}) (.+)$/.exec(line);
    if (!m) continue;
    const text = m[2]!.replace(/<a [^>]*><\/a>/g, "");
    if (m[1] === "##") section = normalizeHeading(text);
    const page = README_PAGES.find((p) => section && (p.sections as readonly string[]).includes(section));
    map.set(slugger.slug(text), page?.route ?? (section ? README_REDIRECTS[section] ?? null : null));
    for (const id of [...m[2]!.matchAll(/<a id="([^"]+)"><\/a>/g)].map((x) => x[1]!)) map.set(id, page?.route ?? null);
  }
  return map;
}

async function build() {
  const version = libVersion();
  const readme = readSource("README.md").text;
  const anchors = readmeAnchorRoutes(readme);
  const routeForFile: LinkContext["routeForFile"] = (p, a) => {
    if (p === "README.md") return a ? anchors.get(a) ?? null : "/docs";
    if (p === "WORKOUTS.md") return "/docs/workouts";
    if (p === "CHANGELOG.md") return "/docs/changelog";
    if (p === "docs/api/README.md") return "/docs/api";
    if (/^docs\/api\/[\w-]+\.md$/.test(p)) return `/docs/api/${p.slice(9, -3)}`;
    if (p === "mcp/README.md") return "/docs/self-host";
    return null;
  };
  const ctx: LinkContext = { version, routeForFile };
  const pages = new Map<string, DocPage>();
  const links = new Map<string, LinkTarget[]>();
  const add = async (route: string, title: string, md: string, repoPath: string) => {
    const r = await renderMarkdown(md.replace(/<!--[\s\S]*?-->/g, ""), repoPath, ctx);
    pages.set(route, { route, title, html: r.html, headings: r.headings, sourceRepoPath: repoPath });
    links.set(route, r.links);
  };
  const sections = splitReadme(readme);
  for (const p of README_PAGES) {
    const missing = p.sections.filter((s) => !sections.has(s));
    if (missing.length) throw new Error(`README section(s) missing for ${p.route}: ${missing.join(", ")}`);
    await add(p.route, p.title, p.sections.map((s) => sections.get(s)!).join("\n\n"), "README.md");
  }
  await add("/docs/workouts", "Building workouts", readSource("WORKOUTS.md").text, "WORKOUTS.md");
  await add("/docs/api", "API by category", readSource("docs/api/README.md").text, "docs/api/README.md");
  for (const f of apiCategoryFiles()) {
    const md = readSource(f).text;
    await add(`/docs/api/${f.slice(9, -3)}`, /^# (.+)$/m.exec(md)?.[1] ?? f, md, f);
  }
  await add("/docs/self-host", "Run it yourself", readSource("mcp/README.md").text, "mcp/README.md");
  await add("/docs/changelog", "Changelog", readSource("CHANGELOG.md").text, "CHANGELOG.md");
  const problems = checkLinks(pages, links);
  if (problems.length) throw new Error(`Broken docs links:\n${problems.join("\n")}`);
  return { pages, links };
}

export function getDocPages() { return (cache ??= build()).then((x) => x.pages); }
export function getAllLinks() { return (cache ??= build()).then((x) => x.links); }
export async function getDocPage(route: string): Promise<DocPage> {
  const page = (await getDocPages()).get(route);
  if (!page) throw new Error(`No doc page ${route}`);
  return page;
}

export function checkLinks(pages: Map<string, DocPage>, links: Map<string, LinkTarget[]>): string[] {
  const problems: string[] = [];
  const known = new Set(["/docs/reference", "/claude", "/demo", "/privacy", "/"]);
  for (const [from, list] of links) for (const l of list) {
    if (/^(https?:|mailto:)/.test(l.route) || known.has(l.route)) continue;
    const page = pages.get(l.route);
    if (!page) { problems.push(`${from} → ${l.route} (no such page)`); continue; }
    if (l.anchor && !page.headings.some((h) => h.id === l.anchor) && !page.html.includes(`id="${l.anchor}"`) && !page.html.includes(`name="${l.anchor}"`)) {
      problems.push(`${from} → ${l.route}#${l.anchor} (no such anchor)`);
    }
  }
  return problems;
}
```

`readmeAnchorRoutes` depends on rehype-slug and GitHub using the same slugger. `github-slugger` is what both use, so the ids match.

- [ ] **Step 7: Run the tests.** Run `npx vitest run tests/docs.test.ts`. Expect a PASS.
  - If the link check reports real broken links in the pinned 0.9.0 docs, check the rule first. If the link really points nowhere upstream, add a single documented exception list `KNOWN_UPSTREAM_BROKEN` in `registry.ts` (each entry with a comment) and report it as a concern. Never relax the check broadly.

- [ ] **Step 8: Commit and push.** Message: `feat: build-time docs pipeline from the pinned npm packages`.

---

### Task 4: Reference data (manifest → methods, tool names)

**Files:**
- Create `src/lib/reference.ts`.
- Test: `tests/reference.test.ts`.

**Interfaces — Produces:**

```ts
export interface MethodRow { name: string; toolName: string; category: string; categoryRoute: string | null; description: string; safety: "read" | "write" | "destructive"; connectPlus: boolean; signature: string; params: { name: string; type: string; optional: boolean; description?: string }[] }
export function methods(): MethodRow[];              // sorted by name
export function method(name: string): MethodRow | undefined;
export function categories(): { name: string; count: number }[];
export function toolName(method: string): string;    // MCP rule
export function typeOf(schema: Record<string, unknown>): string; // JSON schema → short TS-like type
```

`categoryRoute`: the manifest category slug maps to `/docs/api/<file>` when a `docs/api/<file>.md` exists for it. Build this map by reading each api file's methods. A method name appears in a file as `### methodName`, or in a code span like `` `garmin.methodName( ``; take whichever of the two exists, so the map isn't hard-coded. Otherwise `null`.

- [ ] **Step 1: Failing test.** `tests/reference.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GARMIN_METHODS } from "garminconnect-js/manifest";
import { methods, method, toolName, typeOf, categories } from "@/lib/reference";

describe("reference", () => {
  it("has a row for every manifest method", () => {
    expect(methods().map((m) => m.name).sort()).toEqual(GARMIN_METHODS.map((m) => m.name).sort());
  });
  it("names tools exactly like the MCP server", () => {
    expect(toolName("getSleepData")).toBe("get_sleep_data");
    expect(toolName("getSpo2Data")).toBe("get_spo2_data");
    expect(toolName("setActivityExerciseSets")).toBe("set_activity_exercise_sets");
  });
  it("describes parameters and signatures", () => {
    const m = method("getSleepData")!;
    expect(m.safety).toBe("read");
    expect(m.params[0]).toMatchObject({ name: "cdate", optional: false });
    expect(m.signature).toMatch(/^getSleepData\(cdate/);
    expect(typeOf({ type: "string" })).toBe("string");
    expect(typeOf({ anyOf: [{ type: "string" }, { type: "number" }] })).toBe("string | number");
    expect(typeOf({ type: "array", items: { type: "string" } })).toBe("string[]");
    expect(typeOf({ enum: ["kg", "lbs"] })).toBe('"kg" | "lbs"');
    expect(typeOf({})).toBe("unknown");
  });
  it("handles methods with no params", () => {
    expect(method("getUserProfile")!.signature).toBe("getUserProfile()");
  });
  it("flags Connect+ and links categories to a guide when one exists", () => {
    expect(methods().some((m) => m.connectPlus)).toBe(true);
    expect(method("getSleepData")!.categoryRoute).toBe("/docs/api/wellness");
    expect(categories().reduce((n, c) => n + c.count, 0)).toBe(GARMIN_METHODS.length);
  });
});
```

Run `npx vitest run tests/reference.test.ts`. Expect a FAIL.

- [ ] **Step 2: Implement.** `toolName = (m) => m.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())`.
  - `typeOf` handles `type`, `anyOf`/`oneOf` (joined with ` | `), `enum` (JSON-quoted), arrays, `format: "date-time"` → `string (ISO date-time)`, objects → `object`, and anything else → `unknown`.
  - The signature is `name(p1, p2?)`, with `?` marking optional params. Param descriptions come from `schema.description` when present.
  - For `categoryRoute`, scan `apiCategoryFiles()` once with `readSource`. A method belongs to a file if the file contains `` `${name}(`` or `### ${name}`.
  - Import `GARMIN_METHODS` from `garminconnect-js/manifest`.

- [ ] **Step 3: Verify.** Run `npx vitest run tests/reference.test.ts` (PASS). If a method's own file gives a different category route than `getSleepData`'s assertion expects, inspect `docs/api/wellness.md` and fix the matching rule, not the test.

- [ ] **Step 4: Commit and push.** Message: `feat: method reference data from the library manifest`.

---

### Task 5: Docs pages (layout, sidebar, TOC, guides, reference)

**Files:**
- Create `src/app/docs/layout.tsx`, `docs.module.css`, `page.tsx`, `[slug]/page.tsx`, `api/page.tsx`, `api/[category]/page.tsx`, `reference/page.tsx`, `reference/ReferenceTable.tsx`, `reference/[method]/page.tsx`.
- Create `src/components/DocsNav.tsx` and `Toc.tsx`.
- Test: `tests/docs-routes.test.ts`.

**Interfaces — Consumes:** `getDocPages`/`getDocPage` (Task 3); `methods`/`method`/`categories` (Task 4).

- [ ] **Step 1: Failing test.** `tests/docs-routes.test.ts` checks that the route files export `generateStaticParams` covering every page:

```ts
import { describe, expect, it } from "vitest";
import { getDocPages } from "@/lib/docs/registry";
import { methods } from "@/lib/reference";
import { generateStaticParams as slugParams } from "@/app/docs/[slug]/page";
import { generateStaticParams as categoryParams } from "@/app/docs/api/[category]/page";
import { generateStaticParams as methodParams } from "@/app/docs/reference/[method]/page";

describe("docs routes", () => {
  it("statically generate every doc page and every method", async () => {
    const pages = [...(await getDocPages()).keys()];
    const slugs = (await slugParams()).map((p) => `/docs/${p.slug}`);
    const cats = (await categoryParams()).map((p) => `/docs/api/${p.category}`);
    for (const r of pages.filter((r) => r !== "/docs" && r !== "/docs/api")) expect([...slugs, ...cats]).toContain(r);
    expect((await methodParams()).length).toBe(methods().length);
  });
});
```

Run it and expect a FAIL.

- [ ] **Step 2: Implement.**
  - **`docs/layout.tsx`:** a 3-column grid. Columns are `<DocsNav />` (220 px), the content (`minmax(0, 1fr)`) and the TOC slot (200 px, hidden below 1100 px). Below 860 px the sidebar becomes a `<details className="docs-menu"><summary>Docs menu</summary>…</details>` at the top. CSS-only, no JS.
  - **`DocsNav`:**
    - Groups: **Guides** (Getting started `/docs`, Authentication, Code examples, Building workouts, Run it yourself `/docs/self-host`); **API** (`/docs/api` and each category page by title); **Reference** (All methods `/docs/reference`); and Changelog.
    - The current link is marked with `aria-current="page"`. Use `usePathname` in a small client child, `NavLink`.
  - **`Toc`:** takes `headings` and lists depth 2–3 as anchor links under "On this page".
  - **Each guide page:**
    - `page.tsx` renders `/docs`; `[slug]` renders `/docs/<slug>` for authentication, examples, workouts, self-host and changelog; `api/page.tsx` and `api/[category]/page.tsx` render the API index and the category pages.
    - Render `<article className="prose" dangerouslySetInnerHTML={{ __html: page.html }} />` (trusted, build-time) plus `<Toc headings={page.headings} />`.
    - Add `generateMetadata` → `{ title: page.title }` and `export const dynamic = "force-static"`.
    - `generateStaticParams` derives from the registry's routes, so nothing is hard-coded twice.
    - Unknown params → `notFound()`.
  - **Prose CSS** (`docs.module.css`, applied via a global `.prose` class):
    - Readable widths, tables that scroll horizontally within `.prose` (`display:block; overflow-x:auto` on `table`), and images `max-width: 100%`.
    - Headings carry `scroll-margin-top: 72px`, the sticky-header height plus room.
  - **`reference/page.tsx`:** a server component that passes `methods()` and `categories()` to the client component `ReferenceTable`.
    - It shows "N methods · garminconnect-js {version}", then the filter chips: category (all + each), safety (read/write/destructive) and Connect+.
    - It also has a text filter. The table lists name (linked), description and tags.
    - The filter state lives in the URL query (`?category=wellness&safety=read&q=sleep`) with `useSearchParams`, wrapped in `<Suspense>`, so filtered views can be linked.
    - The table sits in a wrapper with `overflow-x: auto`.
  - **`reference/[method]/page.tsx`:**
    - Shows the name, the safety tag, the Connect+ tag, the description, the signature in a `<pre>`, and a params table (name, type, optional, description).
    - Tool line: "In Claude this is the `toolName` tool".
    - Then a link to `categoryRoute` ("Guide: Wellness"), and "Back to all methods".
    - `generateStaticParams` returns every method, and `generateMetadata` sets the title to the method name.

- [ ] **Step 3: Verify.** Run `npx vitest run tests/docs-routes.test.ts`, then `npm run build`. The build log should show the static docs pages, including about 193 reference pages.

- [ ] **Step 4: Commit and push.** Message: `feat: docs pages, sidebar, table of contents and method reference`.

---

### Task 6: Landing page and `/claude`

**Files:**
- Create `src/components/CopyUrl.tsx`.
- Modify `src/app/page.tsx`; create `page.module.css`.
- Create `src/app/claude/page.tsx`, `claude.module.css`, `ClaudeTabs.tsx`.
- Test: `tests/copy-url.test.ts`.

**Interfaces — Produces:**
- `<CopyUrl url={string} />`, a client component.
- `/` and `/claude`. `/claude` accepts `?app=web|desktop|code|other` (default `web`).

- [ ] **Step 1: Failing test for the copy logic.** Extract the logic into `src/lib/copy.ts`, exporting `copyText(text: string, deps: { clipboard?: { writeText(t: string): Promise<void> }; select(): void }): Promise<"copied" | "selected">`.

```ts
import { describe, expect, it, vi } from "vitest";
import { copyText } from "@/lib/copy";

describe("copyText", () => {
  it("uses the clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await copyText("u", { clipboard: { writeText }, select: vi.fn() })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("u");
  });
  it("falls back to selecting the text", async () => {
    const select = vi.fn();
    expect(await copyText("u", { select })).toBe("selected");
    expect(await copyText("u", { clipboard: { writeText: () => Promise.reject(new Error("denied")) }, select })).toBe("selected");
    expect(select).toHaveBeenCalledTimes(2);
  });
});
```

Run it and expect a FAIL. Implement `copy.ts` (try the clipboard, on error or absence call `select()`). Run it and expect a PASS.

- [ ] **Step 2: `CopyUrl`.**
  - It renders a readonly `<input>` holding the URL (monospace, `aria-label="Connector URL"`) and a "Copy" button.
  - On click it calls `copyText`, then shows "Copied" or "Selected — press Ctrl/⌘ C" in an `aria-live="polite"` span for 2 s.
  - On mobile it uses `width: 100%` and a 16 px font, so iOS doesn't zoom.

- [ ] **Step 3: Landing (`/`), design B "two doors".**
  - **Hero:** a centred `<h1>`, "Garmin Connect for Claude — and for your code", with the subline "Ask Claude about your sleep, training and workouts, or build with a zero-dependency TypeScript client."
  - **Two cards:** `grid-template-columns: 1.4fr 1fr` on desktop, stacked on screens narrower than 760 px.
    - **"Use it in Claude"** (primary: a 2 px accent border and the "no install" badge):
      - `<CopyUrl url="https://garmin.ficdev.xyz/mcp" />`;
      - "1 Add custom connector · 2 Sign in to Garmin · 3 Ask";
      - a `btn-primary` link "Set it up" → `/claude`.
    - **"Build with it":**
      - `npm i garminconnect-js` in a code block;
      - "193 methods · TypeScript · Node 18+". Read the count from `methods().length`.
      - a `btn-ghost` link "Read the docs" → `/docs`.
  - **Three tiles:** "What can I ask?" → `/claude#ask`; "Workout builder" → `/docs/workouts`; "Live demo" → `/demo`. Each has one sentence.

- [ ] **Step 4: `/claude`, design C "tabs + things to ask".**
  - **Header:** `<h1>` "Use your Garmin data in Claude", "Free · no install · web, phone and desktop", then `<CopyUrl/>`.
  - **Tabs:**
    - `ClaudeTabs` is a client component with tabs `web` "claude.ai & mobile", `desktop` "Claude Desktop", `code` "Claude Code" and `other` "Other MCP clients".
    - It reads and writes `?app=`; the default is `web`. Use `role="tablist"`, `aria-selected`, and arrow-key navigation.
    - Without JS, every panel renders, stacked one after another (each panel `<section id="web">` etc.), and JS hides the inactive ones. So the content is always reachable.
  - **Steps per tab:**
    - **web:**
      1. In claude.ai: Settings → Connectors → Add custom connector. Name it "Garmin" and paste the URL.
      2. A Garmin sign-in window opens. Sign in, with a code if Garmin asks.
      3. Ask something. The Claude phone app picks up the connector from your account automatically.
    - **desktop:** same as web (Claude Desktop uses your account's connectors). Add: "Prefer it to run on your computer? Use the Desktop Extension" → `/docs/self-host`.
    - **code:** `claude mcp add --transport http garmin https://garmin.ficdev.xyz/mcp`, then `/mcp` inside Claude Code to sign in.
    - **other:** "Add a streamable-HTTP MCP server with this URL; your client opens the Garmin sign-in when it first connects."
  - **"Things to ask" (`id="ask"`):** cards grouped as Sleep & recovery, Training, Workouts, Body & health.
    - Each card has 2 prompts in quotes, for example "How did I sleep this week compared with last week?", "Build 6×400 m at 4:10/km with 2-minute recoveries and schedule it for Thursday", "Am I ready to train hard today?", "Log 72.4 kg for this morning".
    - Write 8 prompts in total, each one answerable by existing tools.
  - **"What's stored" (`id="privacy"`):**
    - Your password goes to Garmin once and is never stored.
    - Your Garmin session lives encrypted inside the connection token your Claude account keeps.
    - The server keeps one row per connection: a random id, a scrambled reference to your Garmin account, the app's name, and timestamps. It's deleted after 35 days unused.
    - Link to `/privacy`.
  - **"Disconnect":** remove the connector in Claude, or tick "Disconnect my other Garmin connections" next time you sign in.
  - **FAQ** (`<details>` items):
    - Is it official? No, it isn't affiliated with Garmin.
    - Does it cost anything? It's free.
    - Can Claude change my data? Some tools write, such as creating workouts or logging weight. Claude asks before destructive ones.
    - Why does sign-in take a few seconds? Garmin's sign-in takes several steps.
    - Does it work with two-factor? Yes.
  - Add `generateMetadata`: title "Use Garmin in Claude".

- [ ] **Step 5: Verify.** Run `npm run build`. Check `/` and `/claude?app=code` in `npm run dev` at 375 px (Chrome device mode): no horizontal scroll, and the cards stack.

- [ ] **Step 6: Commit and push.** Message: `feat: landing page and Claude connector setup page`.

---

### Task 7: Search

**Files:**
- Create `src/lib/search.ts`, `src/app/search-index.json/route.ts`, `src/components/Search.tsx`.
- Modify `src/components/Header.tsx`.
- Test: `tests/search.test.ts`.

**Interfaces — Produces:**
- `buildSearchDocs(): Promise<SearchDoc[]>`, where `SearchDoc = { id: string; route: string; title: string; section?: string; text: string; kind: "guide" | "method" }`.
- `GET /search-index.json` → `SearchDoc[]`, static.
- `<Search />`, a client component.

- [ ] **Step 1: Failing test.**

```ts
import { describe, expect, it } from "vitest";
import MiniSearch from "minisearch";
import { buildSearchDocs, SEARCH_OPTIONS } from "@/lib/search";

describe("search", () => {
  it("indexes guides by section and every method", async () => {
    const docs = await buildSearchDocs();
    expect(docs.filter((d) => d.kind === "method").length).toBeGreaterThan(150);
    const ms = new MiniSearch(SEARCH_OPTIONS);
    ms.addAll(docs);
    expect(ms.search("sleep")[0]).toBeDefined();
    expect(ms.search("getSleepData")[0]?.route).toBe("/docs/reference/getSleepData");
    expect(ms.search("MFA").some((r) => String(r.route).startsWith("/docs/authentication"))).toBe(true);
    expect(new Set(docs.map((d) => d.id)).size).toBe(docs.length);
  });
});
```

Run it and expect a FAIL.

- [ ] **Step 2: Implement.**
  - **`search.ts`:**
    - Split each doc page's HTML into sections at h2/h3. Strip tags and keep at most 600 characters of text per section.
    - Each section's route is `page.route#headingId`. Its title is the page title, and its section field is the heading text.
    - Every method gets a document with route `/docs/reference/<name>` and text `description + category + toolName`.
    - `SEARCH_OPTIONS = { fields: ["title", "section", "text"], storeFields: ["route", "title", "section", "kind"], searchOptions: { boost: { title: 3, section: 2 }, prefix: true, fuzzy: 0.2 } }`.
  - **`route.ts`:** `export const dynamic = "force-static"; export async function GET() { return Response.json(await buildSearchDocs()); }`.
  - **`Search.tsx`:**
    - A button "Search" with a `Ctrl K` hint, which is also bound to Ctrl/⌘+K.
    - It opens a `<dialog>` holding an input and up to 10 results showing title, section and kind tag.
    - Enter navigates, Esc closes, and the arrow keys move the selection.
    - The index is fetched lazily on first open, then indexed with MiniSearch.
    - No results → "No results — try the reference" with a link.
  - In `Header.tsx`, replace `#search-slot` with `<Search />`.

- [ ] **Step 3: Verify.** Run `npx vitest run tests/search.test.ts`, then `npm run build`.

- [ ] **Step 4: Commit and push.** Message: `feat: site search over guides and methods`.

---

### Task 8: Move the demo to `/demo` and add `/privacy`

**Files:**
- Copy from `../garminconnect-nextjs-starter`:
  - `src/lib/{cookie-token-store,demo,garmin,mode,rate-limit,seal,sleep}.ts` → `src/lib/demo/`
  - `src/components/{charts.tsx,charts.module.css,LoginForm.tsx,LoginForm.module.css}` → `src/components/demo/`
  - `src/app/actions.ts` → `src/app/demo/actions.ts`
  - `src/app/page.tsx` → `src/app/demo/page.tsx`
  - `src/app/page.module.css` → `src/app/demo/page.module.css`
- Create `src/app/privacy/page.tsx`.
- Test: `tests/demo-paths.test.ts`.

- [ ] **Step 1: Failing test** (Review Focus 4):

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = ["src/app/demo/page.tsx", "src/app/demo/actions.ts", "src/components/demo/LoginForm.tsx"];

describe("demo paths", () => {
  it("never sends people to the site root by mistake", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/redirect\("\/"\)/);
      expect(src, f).not.toMatch(/href="\/(\?[^"]*)?"/);
      expect(src, f).not.toMatch(/from "@\/lib\/(?!demo\/)(cookie-token-store|demo|garmin|mode|rate-limit|seal|sleep)"/);
    }
  });
  it("links the privacy note to the site privacy page", () => {
    expect(readFileSync("src/components/demo/LoginForm.tsx", "utf8")).toContain('href="/privacy"');
  });
});
```

Run it and expect a FAIL (files missing).

- [ ] **Step 2: Copy and adjust.**
  - Copy the files.
  - Change imports from `@/lib/x` to `@/lib/demo/x` and from `@/components/X` to `@/components/demo/X`.
  - Change `redirect("/")` to `redirect("/demo")` (three places in `actions.ts`).
  - Change `href="/?signin"` to `href="/demo?signin"`, and the "← Back to the demo" `href="/"` to `href="/demo"`.
  - The privacy link stays `/privacy`.
  - Keep `"use server"`/`"server-only"` markers exactly. Behaviour, env names and cookie options stay unchanged.
  - The demo page's own `<h1>` and copy stay. Add a short line above the dashboard: "This is the live demo of garminconnect-js. → Use it in Claude instead", linked to `/claude`.
  - **Brand the sign-in form:** in `LoginForm.module.css`, change the submit button to the brand gradient and the inputs to 16 px. Nothing else.
- [ ] **Step 3: `/privacy`.** Take the starter's `src/app/privacy/page.tsx` text (the demo section) and add a first section, **"Garmin in Claude (the connector)"**, with the same facts as `/claude#privacy`:
  - The server keeps one row per connection: a random id, a keyed hash of your Garmin profile id, the client's name, a state, a counter and timestamps. The row is deleted after 35 days unused.
  - The server never stores your password, your email, your Garmin tokens or your Garmin data.
  - Logs hold a connection-id prefix, the tool name, a status and a duration.

  Keep `PRIVACY_CONTACT` support. Fix the back link to `/`.
- [ ] **Step 4: Verify.**
  - Run `npx vitest run tests/demo-paths.test.ts` and `npm run build`.
  - Run `GARMIN_DEMO=1 SESSION_SECRET=… npm run dev`. `/demo` should show sample data, and the sign-in link should open the form under `/demo?signin`.
- [ ] **Step 5: Commit and push.** Message: `feat: move the sleep & HRV demo to /demo; one privacy page`.

---

### Task 9: End-to-end smoke tests (mobile and desktop)

**Files:** create `e2e/site.spec.ts`, and delete Task 1's placeholder `e2e/smoke.spec.ts`.

- [ ] **Step 1: Write the tests.** They run against `npm run start` with `GARMIN_DEMO=1` (see `playwright.config.ts`) in both projects.

```ts
import { expect, test } from "@playwright/test";

const noSideScroll = async (page: import("@playwright/test").Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

test("landing shows both doors and the connector URL", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByLabel("Connector URL")).toHaveValue("https://garmin.ficdev.xyz/mcp");
  await expect(page.getByRole("link", { name: "Set it up" })).toHaveAttribute("href", "/claude");
  await expect(page.getByRole("link", { name: "Read the docs" })).toHaveAttribute("href", "/docs");
  await noSideScroll(page);
});

test("claude page tabs and copy", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await page.goto("/claude");
  await expect(page.getByRole("tab", { name: "claude.ai & mobile" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Claude Code" }).click();
  await expect(page).toHaveURL(/app=code/);
  await expect(page.getByText("claude mcp add --transport http garmin https://garmin.ficdev.xyz/mcp")).toBeVisible();
  await page.getByRole("button", { name: "Copy" }).first().click();
  await expect(page.getByText(/Copied|Selected/).first()).toBeVisible();
  await noSideScroll(page);
});

test("a guide page renders with working in-page anchors", async ({ page }) => {
  await page.goto("/docs/authentication");
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  await expect(page.locator("pre.shiki").first()).toBeVisible();
  await noSideScroll(page);
});

test("reference filters and method page", async ({ page }) => {
  await page.goto("/docs/reference?safety=destructive");
  const rows = page.locator("table tbody tr");
  await expect(rows.first()).toBeVisible();
  for (const tag of await page.locator("table tbody tr .tag-safety").allTextContents()) expect(tag).toBe("destructive");
  await page.goto("/docs/reference/getSleepData");
  await expect(page.getByText("get_sleep_data")).toBeVisible();
  await noSideScroll(page);
});

test("search finds a method", async ({ page, isMobile }) => {
  await page.goto("/docs");
  await page.getByRole("button", { name: /Search/ }).click();
  await page.getByRole("searchbox").fill("getSleepData");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/docs\/reference\/getSleepData/);
  void isMobile;
});

test("demo shows sample data", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.locator("svg").first()).toBeVisible();
  await noSideScroll(page);
});

test("privacy covers the connector and the demo", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: /connector/i })).toBeVisible();
});
```

(The reference rows must carry `className="tag-safety"` on the safety tag. Add it in Task 5's table if it's missing. The search input is `type="search"`.)

- [ ] **Step 2: Run.** Run `npm run build && npx playwright install chromium && npm run test:e2e`. All tests pass in both projects. Fix the product, not the tests, unless a test's selector is wrong. If one is, keep its intent.

- [ ] **Step 3: Commit and push.** Message: `test: end-to-end smoke for landing, claude, docs, reference, search, demo`. Confirm CI is green on GitHub with `gh run watch`.

---

### Task 10: Cut over in Dokploy (with the user)

No code. Every step needs the user.

- [ ] **Step 1: Note the current demo app's settings in Dokploy.**
  - Its env: `SESSION_SECRET`, `GARMIN_PUBLIC`, and `PRIVACY_CONTACT` if set.
  - Its domain configuration for `garmin.ficdev.xyz` `/`: HTTPS, certificate and port.
- [ ] **Step 2: Create the new app.**
  - Create a new Application `garmin-site` from the GitHub repo `garminconnect-site`, branch `main`, build type Dockerfile (`Dockerfile`, context `.`).
  - Set the same env as the demo app, plus `PORT=3000`.
  - Turn auto deploy on, since this repo has no release cycle. Deploy it.
- [ ] **Step 3: Switch the domain.**
  - Remove the domain `garmin.ficdev.xyz` `/` from the old demo app.
  - Add it to `garmin-site` with the same HTTPS/certificate settings, port 3000 and path `/`.
  - Don't touch the MCP app's three path domains.
- [ ] **Step 4: Check.**
  - `/` serves the landing page.
  - `/demo` works, and someone already signed in to the old demo is still signed in.
  - `/privacy` works.
  - `/mcp/healthz` still returns `ok`.
  - The claude.ai connector still works.
- [ ] **Step 5: Stop the old demo app** in Dokploy, but keep it until the user is happy. Delete it later on the user's word.
- [ ] **Step 6: Update the links.** In the library repo `README.md`, the `[live demo](https://garmin.ficdev.xyz)` link becomes `https://garmin.ficdev.xyz/demo`, and a "website" link goes to `https://garmin.ficdev.xyz`. The starter repo's README should point to the site. Ask first, because these are commits in other repos.
